import {
  BadRequestException,
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
import { productIssues } from './product-rules';
import type { ProductIssue } from './product-rules';
import type {
  ProductInput,
  ProductListQuery,
  ProductUpdateInput,
} from './products.schemas';

export const PRODUCT_NOT_FOUND = 'Product not found';
export const PRODUCT_SLUG_TAKEN =
  'Another product already has this slug. Choose a different one.';
const NO_SUCH_CATEGORY: ProductIssue = {
  field: 'categoryId',
  message: 'No category with this ID',
};

// Everything staff can set: what the audit log keeps of a product.
const STAFF_FIELDS = [
  'categoryId',
  'name',
  'slug',
  'summary',
  'description',
  'ingredients',
  'usage',
  'type',
  'licenceNumber',
  'manufacturerName',
  'manufacturerAddress',
  'countryOfOrigin',
  'isActive',
  'position',
] as const;

const PRODUCT_FIELDS = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  summary: true,
  description: true,
  ingredients: true,
  usage: true,
  type: true,
  licenceNumber: true,
  manufacturerName: true,
  manufacturerAddress: true,
  countryOfOrigin: true,
  isActive: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

// Staff and customers see products in the same order: by position within
// the category, then by name.
const PRODUCT_ORDER = [
  { position: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductOrderByWithRelationInput[];

type Product = Prisma.ProductGetPayload<{ select: typeof PRODUCT_FIELDS }>;

export interface ProductPage {
  products: Product[];
  // Pass it as `after` to get the next page; null on the last page.
  nextAfter: string | null;
}

// The answer the validation pipe gives, for the rules that need the stored
// product or the database.
function invalid(issues: ProductIssue[]): BadRequestException {
  return new BadRequestException({
    message: 'Validation failed',
    errors: issues,
  });
}

// Products (ADR 0021). Admins and Super Users manage them, and every change
// is written to the audit log in the same transaction. A product goes live
// only with its licence and maker details and its ingredients.
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(ProductsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Every product, drafts too, one page at a time. The filters are optional
  // and combine.
  async list(query: ProductListQuery): Promise<ProductPage> {
    const rows = await this.prisma.product.findMany({
      // A filter left out is undefined, and Prisma ignores it.
      where: { categoryId: query.categoryId, isActive: query.isActive },
      orderBy: PRODUCT_ORDER,
      // One more than asked for, to know whether another page exists.
      take: query.limit + 1,
      // Start at the given product, but skip it: it was on the last page.
      ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
      select: PRODUCT_FIELDS,
    });
    const products = rows.slice(0, query.limit);
    return {
      products,
      nextAfter:
        rows.length > query.limit ? products[products.length - 1].id : null,
    };
  }

  async create(input: ProductInput, context: AuditContext): Promise<Product> {
    const product = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: input,
          select: PRODUCT_FIELDS,
        });
        // In the same transaction: no product without its audit entry.
        await this.audit.record(tx, {
          ...context,
          action: 'product.created',
          targetType: 'product',
          targetId: created.id,
          after: pick(created, STAFF_FIELDS),
        });
        return created;
      }),
    );
    this.logger.info(
      { productId: product.id, actorId: context.actorId },
      'Product created',
    );
    return product;
  }

  // Changes only the fields given, and only if the product as it will be
  // still follows the rules: removing the licence of a live product, for
  // example, is refused. A request with no real change is not audited.
  async update(
    id: string,
    input: ProductUpdateInput,
    context: AuditContext,
  ): Promise<Product> {
    const { product, changed } = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lockedProduct(tx, id);
        const fields = changedFields(current, input);
        if (fields.length === 0) {
          return { product: current, changed: false };
        }
        const before = pick(current, fields);
        const after = pick(input, fields);
        const issues = productIssues({ ...current, ...after });
        if (issues.length > 0) {
          throw invalid(issues);
        }
        const updated = await tx.product.update({
          where: { id },
          data: after,
          select: PRODUCT_FIELDS,
        });
        await this.audit.record(tx, {
          ...context,
          action: 'product.updated',
          targetType: 'product',
          targetId: id,
          before,
          after,
        });
        return { product: updated, changed: true };
      }),
    );
    if (changed) {
      this.logger.info(
        { productId: id, actorId: context.actorId },
        'Product changed',
      );
    }
    return product;
  }

  // Locks the product until the transaction ends, then reads it, or answers
  // 404. One change at a time for each product, so an audit entry's
  // "before" is exactly what the change replaced, and the rules see the
  // product as it really is. The ID is sent as a parameter, never pasted
  // into the SQL.
  private async lockedProduct(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Product> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return tx.product.findUniqueOrThrow({
      where: { id },
      select: PRODUCT_FIELDS,
    });
  }

  // The database decides what Prisma reports as an error: a slug another
  // product has (409), or a category that does not exist (400). Two
  // requests at the same moment cannot get around either.
  private async saving<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(PRODUCT_SLUG_TAKEN);
      }
      if (isForeignKeyViolation(error)) {
        throw invalid([NO_SUCH_CATEGORY]);
      }
      throw error;
    }
  }
}
