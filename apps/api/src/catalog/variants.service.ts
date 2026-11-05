import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { changedFields, pick } from './changes';
import { PRODUCT_NOT_FOUND } from './products.service';
import { validationFailed } from './validation-failed';
import { VARIANT_ORDER } from './variant-order';
import { priceIssues } from './variants.schemas';
import type { VariantInput, VariantUpdateInput } from './variants.schemas';

export const VARIANT_NOT_FOUND = 'Pack size not found';
export const SKU_TAKEN =
  'Another pack size already has this SKU. Choose a different one.';
export const SIZE_TAKEN = 'This product already has a pack of this size.';

// Everything staff set, and the product it belongs to: what the audit log
// keeps of a pack size.
const STAFF_FIELDS = [
  'productId',
  'sku',
  'quantity',
  'unit',
  'mrpRupees',
  'priceRupees',
  'isActive',
  'position',
] as const;

const VARIANT_FIELDS = {
  id: true,
  productId: true,
  sku: true,
  quantity: true,
  unit: true,
  mrpRupees: true,
  priceRupees: true,
  isActive: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductVariantSelect;

type Variant = Prisma.ProductVariantGetPayload<{
  select: typeof VARIANT_FIELDS;
}>;

// The pack sizes of products, with their prices (ADR 0022). Admins and
// Super Users manage them, only Super Users delete them, and every change,
// a new price included, is written to the audit log in the same transaction.
@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(VariantsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Every pack size of a product, off sale ones too. A product has only a
  // few, so there is no paging.
  async listForProduct(productId: string): Promise<{ variants: Variant[] }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { variants: { orderBy: VARIANT_ORDER, select: VARIANT_FIELDS } },
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return { variants: product.variants };
  }

  async create(
    productId: string,
    input: VariantInput,
    context: AuditContext,
  ): Promise<Variant> {
    const variant = await this.saving(input.sku, null, () =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.productVariant.create({
          data: { ...input, productId },
          select: VARIANT_FIELDS,
        });
        // In the same transaction: no pack size without its audit entry.
        await this.audit.record(tx, {
          ...context,
          action: 'variant.created',
          targetType: 'variant',
          targetId: created.id,
          after: pick(created, STAFF_FIELDS),
        });
        return created;
      }),
    );
    this.logger.info(
      { variantId: variant.id, productId, actorId: context.actorId },
      'Pack size created',
    );
    return variant;
  }

  // Changes only the fields given, and only if the price is still within
  // the MRP once saved: a lower MRP alone may fall below the stored price.
  // A request with no real change is not audited.
  async update(
    id: string,
    input: VariantUpdateInput,
    context: AuditContext,
  ): Promise<Variant> {
    const { variant, changed } = await this.saving(input.sku, id, () =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lockedVariant(tx, id);
        const fields = changedFields(current, input);
        if (fields.length === 0) {
          return { variant: current, changed: false };
        }
        const before = pick(current, fields);
        const after = pick(input, fields);
        const issues = priceIssues({ ...current, ...after });
        if (issues.length > 0) {
          throw validationFailed(issues);
        }
        const updated = await tx.productVariant.update({
          where: { id },
          data: after,
          select: VARIANT_FIELDS,
        });
        await this.audit.record(tx, {
          ...context,
          action: 'variant.updated',
          targetType: 'variant',
          targetId: id,
          before,
          after,
        });
        return { variant: updated, changed: true };
      }),
    );
    if (changed) {
      this.logger.info(
        { variantId: id, actorId: context.actorId },
        'Pack size changed',
      );
    }
    return variant;
  }

  // Deletes a pack size for good. Only Super Users may: the route is
  // @SuperUserOnly(). The audit entry keeps what it was, prices included.
  async remove(id: string, context: AuditContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedVariant(tx, id);
      await tx.productVariant.delete({ where: { id }, select: { id: true } });
      await this.audit.record(tx, {
        ...context,
        action: 'variant.deleted',
        targetType: 'variant',
        targetId: id,
        before: pick(current, STAFF_FIELDS),
      });
    });
    this.logger.info(
      { variantId: id, actorId: context.actorId },
      'Pack size deleted',
    );
  }

  // Locks the pack size until the transaction ends, then reads it, or
  // answers 404. One change at a time for each pack, so an audit entry's
  // "before" is exactly what the change replaced, and the price check sees
  // the pack as it really is. The ID is sent as a parameter, never pasted
  // into the SQL.
  private async lockedVariant(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Variant> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM product_variants WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException(VARIANT_NOT_FOUND);
    }
    return tx.productVariant.findUniqueOrThrow({
      where: { id },
      select: VARIANT_FIELDS,
    });
  }

  // The database decides what Prisma reports as an error: a product that
  // does not exist (404), or a clash with a unique rule (409). Two unique
  // rules can clash, the SKU and the pack size, so a clash is followed by a
  // look at which one it was. The failed transaction is over by then.
  private async saving<T>(
    sku: string | undefined,
    variantId: string | null,
    save: () => Promise<T>,
  ): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException(PRODUCT_NOT_FOUND);
      }
      if (isUniqueViolation(error)) {
        const owner = sku
          ? await this.prisma.productVariant.findUnique({
              where: { sku },
              select: { id: true },
            })
          : null;
        const skuClash = owner !== null && owner.id !== variantId;
        throw new ConflictException(skuClash ? SKU_TAKEN : SIZE_TAKEN);
      }
      throw error;
    }
  }
}
