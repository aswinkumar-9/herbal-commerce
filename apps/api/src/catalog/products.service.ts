import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { MediaStorage } from '../media/media-storage';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CATEGORY_NOT_FOUND } from './categories.service';
import { changedFields, pick } from './changes';
import { IMAGE_ORDER, imageFileNames, removeImageFiles } from './image-files';
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
// address of its files: the shop shows no IDs.
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
    private readonly media: MediaStorage,
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
        // Going live needs an image too. Counted while the product is
        // locked, so an image deleted at the same moment cannot slip by.
        const imageCount = await tx.productImage.count({
          where: { productId: id },
        });
        const issues = productIssues({ ...current, ...after, imageCount });
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

  // Deletes a product for good, with its pack sizes and its images. Only
  // Super Users may: the route is @SuperUserOnly(). The audit entry keeps
  // what the product was, its pack sizes, prices and images included. The
  // image files are deleted once the deletion is saved.
  async remove(id: string, context: AuditContext): Promise<void> {
    const images = await this.prisma.$transaction(async (tx) => {
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
    });
    for (const { fileKey } of images) {
      await removeImageFiles(this.media, this.logger, fileKey);
    }
    this.logger.info(
      { productId: id, actorId: context.actorId },
      'Product deleted',
    );
  }

  // A category's page in the shop: the category and its active products,
  // one page at a time, each with the lowest price of its packs on sale
  // (fromPriceRupees, null while none is on sale) and the small file of its
  // main photo (imageUrl). A hidden category answers 404, like an unknown
  // one. Pages continue after a product's slug: customers never see product
  // IDs.
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
      .map(({ variants, images, ...card }) => ({
        ...card,
        fromPriceRupees: variants[0]?.priceRupees ?? null,
        // A live product always has an image; null only guards the type.
        imageUrl: images[0]
          ? this.media.url(imageFileNames(images[0].fileKey).small)
          : null,
      }));
    return {
      category,
      products,
      nextAfter:
        rows.length > query.limit ? products[products.length - 1].slug : null,
    };
  }

  // A product's own page in the shop. Only an active product in an active
  // category: any other answers 404, like an unknown one. Each image has the
  // addresses of its two files, its size, and a description: the product's
  // name when staff gave none.
  async findForShop(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, category: { isActive: true } },
      select: SHOP_PAGE_FIELDS,
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return {
      ...product,
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
