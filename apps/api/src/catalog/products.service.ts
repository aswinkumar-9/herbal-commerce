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
import { CATEGORY_NOT_FOUND } from './categories.service';
import { changedFields, pick } from './changes';
import { productIssues } from './product-rules';
import type { ProductIssue } from './product-rules';
import type {
  ProductInput,
  ProductListQuery,
  ProductUpdateInput,
  ShopProductListQuery,
} from './products.schemas';
import { validationFailed } from './validation-failed';
import { VARIANT_ORDER } from './variant-order';

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
  'hsnCode',
  'gstRate',
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
  hsnCode: true,
  gstRate: true,
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

// What a category's page shows of each product, with the price of its
// cheapest pack on sale, if any (ADR 0022).
const SHOP_LIST_FIELDS = {
  name: true,
  slug: true,
  summary: true,
  variants: {
    where: { isActive: true },
    orderBy: { pricePaise: 'asc' },
    take: 1,
    select: { pricePaise: true },
  },
} satisfies Prisma.ProductSelect;

// What a product's own page shows. The licence and maker details must be
// on it (ADR 0021), and its packs on sale with their prices (ADR 0022). A
// pack is known by its SKU: the shop shows no IDs.
const SHOP_PAGE_FIELDS = {
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
  category: { select: { name: true, slug: true } },
  variants: {
    where: { isActive: true },
    orderBy: VARIANT_ORDER,
    select: {
      sku: true,
      quantity: true,
      unit: true,
      mrpPaise: true,
      pricePaise: true,
    },
  },
} satisfies Prisma.ProductSelect;

// What the audit log keeps of a deleted product's pack sizes.
const DELETED_VARIANT_FIELDS = {
  sku: true,
  quantity: true,
  unit: true,
  mrpPaise: true,
  pricePaise: true,
  isActive: true,
} satisfies Prisma.ProductVariantSelect;

type Product = Prisma.ProductGetPayload<{ select: typeof PRODUCT_FIELDS }>;

export interface ProductPage {
  products: Product[];
  // Pass it as `after` to get the next page; null on the last page.
  nextAfter: string | null;
}

// Products (ADR 0021). Admins and Super Users manage them, only Super Users
// delete them, and every change is written to the audit log in the same
// transaction. A product goes live only with its licence and maker details
// and its ingredients. Customers see it while it and its category are active.
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
          throw validationFailed(issues);
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

  // Deletes a product for good, with its pack sizes. Only Super Users may:
  // the route is @SuperUserOnly(). The audit entry keeps what the product
  // was, its pack sizes and their prices included.
  async remove(id: string, context: AuditContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedProduct(tx, id);
      const variants = await tx.productVariant.findMany({
        where: { productId: id },
        orderBy: VARIANT_ORDER,
        select: DELETED_VARIANT_FIELDS,
      });
      await tx.product.delete({ where: { id }, select: { id: true } });
      await this.audit.record(tx, {
        ...context,
        action: 'product.deleted',
        targetType: 'product',
        targetId: id,
        before: { ...pick(current, STAFF_FIELDS), variants },
      });
    });
    this.logger.info(
      { productId: id, actorId: context.actorId },
      'Product deleted',
    );
  }

  // A category's page in the shop: the category and its active products,
  // one page at a time, each with the lowest price of its packs on sale
  // (fromPricePaise, null while none is on sale). A hidden category answers
  // 404, like an unknown one. Pages continue after a product's slug:
  // customers never see product IDs.
  async listForShop(categorySlug: string, query: ShopProductListQuery) {
    const category = await this.prisma.category.findFirst({
      where: { slug: categorySlug, isActive: true },
      select: { name: true, slug: true, description: true },
    });
    if (!category) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
    const rows = await this.prisma.product.findMany({
      where: {
        isActive: true,
        category: { slug: categorySlug, isActive: true },
      },
      orderBy: PRODUCT_ORDER,
      take: query.limit + 1,
      ...(query.after ? { cursor: { slug: query.after }, skip: 1 } : {}),
      select: SHOP_LIST_FIELDS,
    });
    const products = rows
      .slice(0, query.limit)
      .map(({ variants, ...card }) => ({
        ...card,
        fromPricePaise: variants[0]?.pricePaise ?? null,
      }));
    return {
      category,
      products,
      nextAfter:
        rows.length > query.limit ? products[products.length - 1].slug : null,
    };
  }

  // A product's own page in the shop. Only an active product in an active
  // category: any other answers 404, like an unknown one.
  async findForShop(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, category: { isActive: true } },
      select: SHOP_PAGE_FIELDS,
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
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
        throw validationFailed([NO_SUCH_CATEGORY]);
      }
      throw error;
    }
  }
}
