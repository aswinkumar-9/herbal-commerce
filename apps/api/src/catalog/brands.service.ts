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
import type { BrandInput, BrandUpdateInput } from './brands.schemas';
import { changedFields, pick } from './changes';

export const BRAND_NOT_FOUND = 'Brand not found';
export const BRAND_SLUG_TAKEN =
  'Another brand already has this slug. Choose a different one.';
export const BRAND_HAS_PRODUCTS =
  'This brand still has products. Choose another brand for them, or none, first.';

const BRAND_FIELDS = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BrandSelect;

// By name, as staff look for one.
const BRAND_ORDER = [
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.BrandOrderByWithRelationInput[];

type Brand = Prisma.BrandGetPayload<{ select: typeof BRAND_FIELDS }>;

// A brand as staff see it: with how many products have it, drafts too, as
// a brand can be deleted only once none has.
export type StaffBrand = Brand & { productCount: number };

// What the audit log keeps of a brand: everything staff can set.
function auditFields({ name, slug }: Brand) {
  return { name, slug };
}

// Brands (part 15A). Admins and Super Users keep the list, only Super Users
// delete one, and every change is written to the audit log in the same
// transaction. Each product may have one.
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(BrandsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Every brand, by name. A shop has only a few, so there is no paging.
  async list(): Promise<{ brands: StaffBrand[] }> {
    const rows = await this.prisma.brand.findMany({
      orderBy: BRAND_ORDER,
      select: { ...BRAND_FIELDS, _count: { select: { products: true } } },
    });
    return {
      brands: rows.map(({ _count, ...brand }) => ({
        ...brand,
        productCount: _count.products,
      })),
    };
  }

  async create(input: BrandInput, context: AuditContext): Promise<Brand> {
    const brand = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.brand.create({
          data: input,
          select: BRAND_FIELDS,
        });
        // In the same transaction: no brand without its audit entry.
        await this.audit.record(tx, {
          ...context,
          action: 'brand.created',
          targetType: 'brand',
          targetId: created.id,
          after: auditFields(created),
        });
        return created;
      }),
    );
    this.logger.info(
      { brandId: brand.id, actorId: context.actorId },
      'Brand created',
    );
    return brand;
  }

  // Changes only the fields given. A field set to the value it already has
  // is no change, and a request with no real change is not audited.
  async update(
    id: string,
    input: BrandUpdateInput,
    context: AuditContext,
  ): Promise<Brand> {
    const { brand, changed } = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lockedBrand(tx, id);
        const fields = changedFields(current, input);
        if (fields.length === 0) {
          return { brand: current, changed: false };
        }
        const before = pick(current, fields);
        const after = pick(input, fields);
        const updated = await tx.brand.update({
          where: { id },
          data: after,
          select: BRAND_FIELDS,
        });
        await this.audit.record(tx, {
          ...context,
          action: 'brand.updated',
          targetType: 'brand',
          targetId: id,
          before,
          after,
        });
        return { brand: updated, changed: true };
      }),
    );
    if (changed) {
      this.logger.info(
        { brandId: id, actorId: context.actorId },
        'Brand changed',
      );
    }
    return brand;
  }

  // Deletes a brand for good. Only Super Users may: the route is
  // @SuperUserOnly(). The audit entry keeps what the brand was. While a
  // product has it, the database refuses (ON DELETE RESTRICT), and the
  // answer is 409.
  async remove(id: string, context: AuditContext): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await this.lockedBrand(tx, id);
        await tx.brand.delete({ where: { id }, select: { id: true } });
        await this.audit.record(tx, {
          ...context,
          action: 'brand.deleted',
          targetType: 'brand',
          targetId: id,
          before: auditFields(current),
        });
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(BRAND_HAS_PRODUCTS);
      }
      throw error;
    }
    this.logger.info(
      { brandId: id, actorId: context.actorId },
      'Brand deleted',
    );
  }

  // Locks the brand until the transaction ends, then reads it, or answers
  // 404. One change at a time for each brand, so an audit entry's "before"
  // is exactly what the change replaced. The ID is sent as a parameter,
  // never pasted into the SQL.
  private async lockedBrand(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Brand> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM brands WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException(BRAND_NOT_FOUND);
    }
    return tx.brand.findUniqueOrThrow({
      where: { id },
      select: BRAND_FIELDS,
    });
  }

  // A slug used by another brand answers 409. The unique index decides, so
  // two requests at the same moment cannot both take it.
  private async saving<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(BRAND_SLUG_TAKEN);
      }
      throw error;
    }
  }
}
