import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { StockService } from '../inventory/stock.service';
import { MediaStorage } from '../media/media-storage';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  CATEGORY_NOT_FOUND,
  CATEGORY_ORDER,
  SHOP_CATEGORY_FIELDS,
} from './categories.service';
import { changedFields, pick } from './changes';
import { IMAGE_ORDER, imageFileNames, removeImageFiles } from './image-files';
import { productIssues } from './product-rules';
import type { ProductIssue } from './product-rules';
import type {
  ProductInput,
  ProductListQuery,
  ProductOrderInput,
  ProductOrderQuery,
  ProductUpdateInput,
  ShopProductListQuery,
} from './products.schemas';
import { SHOWN_CATEGORY } from './shown-categories';
import { validationFailed } from './validation-failed';
import { VARIANT_ORDER } from './variant-order';

export const PRODUCT_NOT_FOUND = 'Product not found';
export const PRODUCT_SLUG_TAKEN =
  'Another product already has this slug. Choose a different one.';
export const PRODUCT_HAS_STOCK =
  'This product still has stock. Write it off first, then delete it.';
export const PRODUCTS_CHANGED =
  'The products in this category changed while you were ordering them. Reload and try again.';
const NO_SUCH_CATEGORY: ProductIssue = {
  field: 'categoryId',
  message: 'No category with this ID',
};
const NO_SUCH_BRAND: ProductIssue = {
  field: 'brandId',
  message: 'No brand with this ID',
};
const NO_SUCH_OTHER_CATEGORY: ProductIssue = {
  field: 'otherCategoryIds',
  message: 'No category with one of these IDs',
};
const MAIN_IS_OTHER: ProductIssue = {
  field: 'otherCategoryIds',
  message: 'Its main category cannot be one of its other categories too',
};

// Everything staff can set: what the audit log keeps of a product.
const STAFF_FIELDS = [
  'categoryId',
  'otherCategoryIds',
  'brandId',
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
  brandId: true,
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
  otherCategories: {
    orderBy: { categoryId: 'asc' },
    select: { categoryId: true },
  },
} satisfies Prisma.ProductSelect;

// Staff and customers see products in the same order: by position within
// the category, then by name.
const PRODUCT_ORDER = [
  { position: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductOrderByWithRelationInput[];

// What a category's page shows of each product, with the price of its
// cheapest pack on sale, if any (ADR 0022), and its main photo (ADR 0023).
const SHOP_LIST_FIELDS = {
  name: true,
  slug: true,
  summary: true,
  variants: {
    where: { isActive: true },
    orderBy: { priceRupees: 'asc' },
    take: 1,
    select: { priceRupees: true },
  },
  images: { orderBy: IMAGE_ORDER, take: 1, select: { fileKey: true } },
} satisfies Prisma.ProductSelect;

// What a product's own page shows. The licence and maker details must be
// on it (ADR 0021), its packs on sale with their prices (ADR 0022), and its
// images (ADR 0023). A pack is known by its SKU, and an image by the
// address of its files: the shop shows no IDs. A pack's ID is read only to
// ask the inventory whether it is in stock (ADR 0024).
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
  category: {
    select: {
      name: true,
      slug: true,
      parent: { select: { name: true, slug: true } },
    },
  },
  brand: { select: { name: true, slug: true } },
  variants: {
    where: { isActive: true },
    orderBy: VARIANT_ORDER,
    select: {
      id: true,
      sku: true,
      quantity: true,
      unit: true,
      mrpRupees: true,
      priceRupees: true,
    },
  },
  images: {
    orderBy: IMAGE_ORDER,
    select: { fileKey: true, width: true, height: true, altText: true },
  },
} satisfies Prisma.ProductSelect;

// What the audit log keeps of a deleted product's pack sizes.
const DELETED_VARIANT_FIELDS = {
  sku: true,
  quantity: true,
  unit: true,
  mrpRupees: true,
  priceRupees: true,
  isActive: true,
} satisfies Prisma.ProductVariantSelect;

// What the audit log keeps of a deleted product's images.
const DELETED_IMAGE_FIELDS = {
  fileKey: true,
  width: true,
  height: true,
  altText: true,
  position: true,
} satisfies Prisma.ProductImageSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_FIELDS }>;

// A product as staff see it: with the IDs of the other categories it is
// also shown in (part 15A).
type Product = Omit<ProductRow, 'otherCategories'> & {
  otherCategoryIds: string[];
};

function staffProduct({ otherCategories, ...product }: ProductRow): Product {
  return {
    ...product,
    otherCategoryIds: otherCategories.map((other) => other.categoryId),
  };
}

// Whether two lists hold the same IDs, in any order. Each list holds an ID
// once.
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

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
    private readonly media: MediaStorage,
    private readonly stock: StockService,
    @InjectPinoLogger(ProductsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Every product, drafts too, one page at a time. The filters are optional
  // and combine.
  async list(query: ProductListQuery): Promise<ProductPage> {
    if (query.q) {
      return this.search(query.q, query);
    }
    const rows = await this.prisma.product.findMany({
      // A filter left out is undefined, and Prisma ignores it.
      where: {
        categoryId: query.categoryId,
        brandId: query.brandId,
        isActive: query.isActive,
      },
      orderBy: PRODUCT_ORDER,
      // One more than asked for, to know whether another page exists.
      take: query.limit + 1,
      // Start at the given product, but skip it: it was on the last page.
      ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
      select: PRODUCT_FIELDS,
    });
    const products = rows.slice(0, query.limit).map(staffProduct);
    return {
      products,
      nextAfter:
        rows.length > query.limit ? products[products.length - 1].id : null,
    };
  }

  // One product, drafts too, for its page in the admin console (ADR 0032).
  async findForStaff(id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: PRODUCT_FIELDS,
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return staffProduct(product);
  }

  async create(input: ProductInput, context: AuditContext): Promise<Product> {
    const { otherCategoryIds = [], ...fields } = input;
    const product = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        await this.brandKept(tx, fields.brandId);
        const others = await this.othersAdded(
          tx,
          fields.categoryId,
          otherCategoryIds,
          [],
        );
        const created = staffProduct(
          await tx.product.create({
            data: { ...fields, otherCategories: { create: others } },
            select: PRODUCT_FIELDS,
          }),
        );
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
  // example, is refused. A request with no real change is not audited. A
  // list of other categories replaces the old one: those kept keep their
  // place, and those added go last in their category.
  async update(
    id: string,
    input: ProductUpdateInput,
    context: AuditContext,
  ): Promise<Product> {
    const { product, changed } = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lockedProduct(tx, id);
        const { otherCategoryIds, ...rest } = input;
        const fields = changedFields(current, rest);
        const others =
          otherCategoryIds === undefined ||
          sameIds(otherCategoryIds, current.otherCategoryIds)
            ? undefined
            : [...otherCategoryIds].sort();
        if (fields.length === 0 && !others) {
          return { product: current, changed: false };
        }
        const changes = pick(rest, fields);
        const before = {
          ...pick(current, fields),
          ...(others ? { otherCategoryIds: current.otherCategoryIds } : {}),
        };
        const after = {
          ...changes,
          ...(others ? { otherCategoryIds: others } : {}),
        };
        await this.brandKept(tx, changes.brandId);
        const added = await this.othersAdded(
          tx,
          changes.categoryId ?? current.categoryId,
          others ?? current.otherCategoryIds,
          current.otherCategoryIds,
        );
        // Going live needs an image too. Counted while the product is
        // locked, so an image deleted at the same moment cannot slip by.
        const imageCount = await tx.productImage.count({
          where: { productId: id },
        });
        const issues = productIssues({ ...current, ...changes, imageCount });
        if (issues.length > 0) {
          throw validationFailed(issues);
        }
        const updated = staffProduct(
          await tx.product.update({
            where: { id },
            data: {
              ...changes,
              ...(others
                ? {
                    otherCategories: {
                      deleteMany: { categoryId: { notIn: others } },
                      create: added,
                    },
                  }
                : {}),
            },
            select: PRODUCT_FIELDS,
          }),
        );
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

  // Deletes a product for good, with its pack sizes and its images. Only
  // Super Users may: the route is @SuperUserOnly(). The audit entry keeps
  // what the product was, its pack sizes, prices and images included. The
  // image files are deleted once the deletion is saved. A product with a
  // pack that still holds stock is refused (ADR 0024).
  async remove(id: string, context: AuditContext): Promise<void> {
    const images = await this.withoutStock(() =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lockedProduct(tx, id);
        const variants = await tx.productVariant.findMany({
          where: { productId: id },
          orderBy: VARIANT_ORDER,
          select: DELETED_VARIANT_FIELDS,
        });
        const productImages = await tx.productImage.findMany({
          where: { productId: id },
          orderBy: IMAGE_ORDER,
          select: DELETED_IMAGE_FIELDS,
        });
        await tx.product.delete({ where: { id }, select: { id: true } });
        await this.audit.record(tx, {
          ...context,
          action: 'product.deleted',
          targetType: 'product',
          targetId: id,
          before: {
            ...pick(current, STAFF_FIELDS),
            variants,
            images: productImages,
          },
        });
        return productImages;
      }),
    );
    for (const { fileKey } of images) {
      await removeImageFiles(this.media, this.logger, fileKey);
    }
    this.logger.info(
      { productId: id, actorId: context.actorId },
      'Product deleted',
    );
  }

  // A category's page in the shop: the category, with the top category it
  // sits in (parent) or its active subcategories (part 15A), and the live
  // products shown in it, one page at a time, each with the lowest price of its
  // packs on sale (fromPriceRupees, null while none is on sale) and the
  // small file of its main photo (imageUrl). A hidden category answers 404,
  // like an unknown one, and so does a subcategory of a hidden one. Pages
  // continue after a product's slug: customers never see product IDs.
  async listForShop(categorySlug: string, query: ShopProductListQuery) {
    const found = await this.prisma.category.findFirst({
      where: { slug: categorySlug, ...SHOWN_CATEGORY },
      select: {
        id: true,
        ...SHOP_CATEGORY_FIELDS,
        parent: { select: { name: true, slug: true } },
        subcategories: {
          where: { isActive: true },
          orderBy: CATEGORY_ORDER,
          select: SHOP_CATEGORY_FIELDS,
        },
      },
    });
    if (!found) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
    // The shop never shows IDs.
    const { id: categoryId, ...category } = found;
    // Its own live products, and the live ones also shown in it (part 15A),
    // each at its place here, one more than asked for, to know whether
    // another page exists. A product shown here from another category is
    // live while its main category is shown. The values are bound
    // parameters, never part of the SQL.
    const listed = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH listed AS (
        SELECT p."id", p."slug", p."name", p."position"
          FROM "products" p
         WHERE p."categoryId" = ${categoryId}::uuid AND p."isActive"
        UNION ALL
        SELECT p."id", p."slug", p."name", o."position"
          FROM "product_categories" o
          JOIN "products" p ON p."id" = o."productId"
          JOIN "categories" c ON c."id" = p."categoryId"
          LEFT JOIN "categories" top ON top."id" = c."parentId"
         WHERE o."categoryId" = ${categoryId}::uuid AND p."isActive"
           AND c."isActive" AND (top."id" IS NULL OR top."isActive")
      )
      SELECT "id" FROM listed
       WHERE ${query.after ?? null}::text IS NULL
          OR ("position", "name", "id") >
             (SELECT "position", "name", "id" FROM listed
               WHERE "slug" = ${query.after ?? null}::text)
       ORDER BY "position", "name", "id"
       LIMIT ${query.limit + 1}`;
    const ids = listed.slice(0, query.limit).map((row) => row.id);
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, ...SHOP_LIST_FIELDS },
    });
    const cards = new Map(
      rows.map(({ id, variants, images, ...card }) => [
        id,
        {
          ...card,
          fromPriceRupees: variants[0]?.priceRupees ?? null,
          // A live product always has an image; null only guards the type.
          imageUrl: images[0]
            ? this.media.url(imageFileNames(images[0].fileKey).small)
            : null,
        },
      ]),
    );
    // In the order listed. One hidden or deleted in between is left out.
    const products = ids.flatMap((id) => {
      const card = cards.get(id);
      return card ? [card] : [];
    });
    return {
      category,
      products,
      nextAfter:
        listed.length > query.limit ? (products.at(-1)?.slug ?? null) : null,
    };
  }

  // A product's own page in the shop. Only an active product in a category
  // customers see: any other answers 404, like an unknown one. Its category
  // comes with the top category it sits in, if any. Each image has the
  // addresses of its two files, its size, and a description: the product's
  // name when staff gave none.
  async findForShop(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, category: SHOWN_CATEGORY },
      select: SHOP_PAGE_FIELDS,
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    const inStock = await this.stock.inStock(
      product.variants.map((variant) => variant.id),
    );
    return {
      ...product,
      // Each pack by its SKU, and only whether it can be bought.
      variants: product.variants.map(({ id, ...pack }) => ({
        ...pack,
        inStock: inStock.has(id),
      })),
      images: product.images.map(({ fileKey, width, height, altText }) => {
        const names = imageFileNames(fileKey);
        return {
          url: this.media.url(names.large),
          thumbnailUrl: this.media.url(names.small),
          altText: altText ?? product.name,
          width,
          height,
        };
      }),
    };
  }

  // Every product shown in a category, drafts too, in the order customers
  // see them: what staff drag into a new order (ADR 0032). Those whose main
  // category it is, and those also shown in it (part 15A).
  async listOrder({
    categoryId,
  }: ProductOrderQuery): Promise<{ products: Product[] }> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw validationFailed([NO_SUCH_CATEGORY]);
    }
    return { products: await this.shownIn(categoryId) };
  }

  // Puts a category's products in a new order, from the whole list first to
  // last, as staff dragged them (ADR 0032). Each one's position becomes its
  // place in the list: a product whose main category it is gets it as its
  // position, and one also shown in it (part 15A) as its place there. All
  // of it is saved in one transaction, with an audit entry for each product
  // that moved.
  async reorder(
    { categoryId, ids }: ProductOrderInput,
    context: AuditContext,
  ): Promise<{ products: Product[] }> {
    const moved = await this.prisma.$transaction(async (tx) => {
      // The category must exist, and stay while its products are ordered.
      const category = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM categories WHERE id = ${categoryId}::uuid FOR KEY SHARE`;
      if (category.length === 0) {
        throw validationFailed([NO_SUCH_CATEGORY]);
      }
      // Its own products, then the ones also shown in it, each locked in
      // the order of their IDs, as everywhere.
      const own = await tx.$queryRaw<{ id: string; position: number }[]>`
        SELECT id, position FROM products
         WHERE "categoryId" = ${categoryId}::uuid
         ORDER BY id FOR NO KEY UPDATE`;
      const shown = await tx.$queryRaw<{ id: string; position: number }[]>`
        SELECT "productId" AS id, position FROM product_categories
         WHERE "categoryId" = ${categoryId}::uuid
         ORDER BY "productId" FOR NO KEY UPDATE`;
      const was = new Map(own.map((row) => [row.id, row.position]));
      const wasShown = new Map(shown.map((row) => [row.id, row.position]));
      // The list must be every product shown in the category, drafts too:
      // one added, moved or deleted since staff loaded the page would
      // otherwise be left out of the order.
      if (
        own.length + shown.length !== ids.length ||
        ids.some((id) => !was.has(id) && !wasShown.has(id))
      ) {
        throw new ConflictException(PRODUCTS_CHANGED);
      }
      let count = 0;
      for (const [position, id] of ids.entries()) {
        const mainBefore = was.get(id);
        const shownBefore = wasShown.get(id);
        if ((mainBefore ?? shownBefore) === position) {
          continue;
        }
        if (mainBefore !== undefined) {
          await tx.product.update({
            where: { id },
            data: { position },
            select: { id: true },
          });
        } else {
          await tx.productCategory.update({
            where: { productId_categoryId: { productId: id, categoryId } },
            data: { position },
            select: { productId: true },
          });
        }
        await this.audit.record(tx, {
          ...context,
          action: 'product.updated',
          targetType: 'product',
          targetId: id,
          ...(mainBefore !== undefined
            ? { before: { position: mainBefore }, after: { position } }
            : {
                before: {
                  otherCategoryPosition: { categoryId, position: shownBefore },
                },
                after: { otherCategoryPosition: { categoryId, position } },
              }),
        });
        count += 1;
      }
      return count;
    });
    if (moved > 0) {
      this.logger.info(
        { categoryId, moved, actorId: context.actorId },
        'Products reordered',
      );
    }
    return { products: await this.shownIn(categoryId) };
  }

  // Staff search by name, drafts too, with the shop's trigram matching
  // (ADR 0030): the best matches first, on one page. The words, the
  // category and the status are bound parameters, never part of the SQL.
  private async search(
    words: string,
    { categoryId, brandId, isActive, limit }: ProductListQuery,
  ): Promise<ProductPage> {
    const matches = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p."id"
        FROM "products" p
       WHERE ${words} <% p."name"
         AND (${categoryId ?? null}::uuid IS NULL
              OR p."categoryId" = ${categoryId ?? null}::uuid)
         AND (${brandId ?? null}::uuid IS NULL
              OR p."brandId" = ${brandId ?? null}::uuid)
         AND (${isActive ?? null}::boolean IS NULL
              OR p."isActive" = ${isActive ?? null}::boolean)
       ORDER BY word_similarity(${words}, p."name") DESC, p."name", p."id"
       LIMIT ${limit}`;
    const products = await this.inOrder(matches.map((match) => match.id));
    return { products, nextAfter: null };
  }

  // Every product shown in the category, drafts too, in the order customers
  // see them: those whose main category it is, and those also shown in it,
  // each at its own place. The ID is a bound parameter.
  private async shownIn(categoryId: string): Promise<Product[]> {
    const shown = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM (
        SELECT p."id", p."name", p."position"
          FROM "products" p
         WHERE p."categoryId" = ${categoryId}::uuid
        UNION ALL
        SELECT p."id", p."name", o."position"
          FROM "product_categories" o
          JOIN "products" p ON p."id" = o."productId"
         WHERE o."categoryId" = ${categoryId}::uuid
      ) shown
       ORDER BY "position", "name", "id"`;
    return this.inOrder(shown.map((row) => row.id));
  }

  // These products as staff see them, in this order. One deleted in
  // between is left out.
  private async inOrder(ids: string[]): Promise<Product[]> {
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: PRODUCT_FIELDS,
    });
    const byId = new Map(rows.map((row) => [row.id, staffProduct(row)]));
    return ids.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    });
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
    return staffProduct(
      await tx.product.findUniqueOrThrow({
        where: { id },
        select: PRODUCT_FIELDS,
      }),
    );
  }

  // The other categories a product is to be shown in (part 15A): never its
  // main one, and each must exist. Those added to its list are locked
  // (KEY SHARE: their deletion waits) and go last among their category's
  // products. Gives what to save for each one added.
  private async othersAdded(
    tx: Prisma.TransactionClient,
    mainId: string,
    otherIds: string[],
    currentIds: string[],
  ): Promise<{ categoryId: string; position: number }[]> {
    if (otherIds.includes(mainId)) {
      throw validationFailed([MAIN_IS_OTHER]);
    }
    const added = otherIds.filter((id) => !currentIds.includes(id));
    if (added.length === 0) {
      return [];
    }
    const rows = await tx.$queryRaw<{ id: string; position: number }[]>`
      SELECT c."id", (LEAST(9998, COALESCE(GREATEST(
               (SELECT MAX(p."position") FROM "products" p
                 WHERE p."categoryId" = c."id"),
               (SELECT MAX(o."position") FROM "product_categories" o
                 WHERE o."categoryId" = c."id")
             ), -1)) + 1)::int AS "position"
        FROM "categories" c
       WHERE c."id" = ANY(${added}::uuid[])
       ORDER BY c."id"
         FOR KEY SHARE OF c`;
    if (rows.length !== added.length) {
      throw validationFailed([NO_SUCH_OTHER_CATEGORY]);
    }
    return rows.map((row) => ({ categoryId: row.id, position: row.position }));
  }

  // A product's brand must exist, and stay while the product is saved with
  // it: KEY SHARE lets other changes to the brand go on, but its deletion
  // waits. No brand, or none given, needs no check.
  private async brandKept(
    tx: Prisma.TransactionClient,
    brandId: string | null | undefined,
  ): Promise<void> {
    if (!brandId) {
      return;
    }
    const found = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM brands WHERE id = ${brandId}::uuid FOR KEY SHARE`;
    if (found.length === 0) {
      throw validationFailed([NO_SUCH_BRAND]);
    }
  }

  // A batch that still holds stock is never deleted, and its product with
  // it: the database refuses, and Prisma reports P2003. Nothing else
  // refers to a product's pack sizes today.
  private async withoutStock<T>(remove: () => Promise<T>): Promise<T> {
    try {
      return await remove();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(PRODUCT_HAS_STOCK);
      }
      throw error;
    }
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
