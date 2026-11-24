import { z } from 'zod';
import { ApiError } from '../api/api-error';
import { apiRequest, apiUpload } from '../api/client';

// The staff catalog API (ADR 0020 to 0023, 0032 for ordering and search,
// 0033 for the order of pack sizes and images): what the console reads and
// sends. Every answer is checked against these shapes.

const CATEGORIES = '/v1/staff/categories';
const BRANDS = '/v1/staff/brands';
const PRODUCTS = '/v1/staff/products';
const VARIANTS = '/v1/staff/variants';
const IMAGES = '/v1/staff/images';

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  position: z.number().int(),
  // The top category it sits in (part 15A); null for a top category.
  parentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Category = z.infer<typeof categorySchema>;
const categoryListSchema = z.object({ categories: z.array(categorySchema) });

// A brand (part 15A): staff keep the list, and each product may have one.
// A brand as a create or a change gives it back.
export const brandSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedBrand = z.infer<typeof brandSchema>;
// As the list gives it: with how many products have it, drafts too.
const listedBrandSchema = brandSchema.extend({
  productCount: z.number().int().min(0),
});
export type Brand = z.infer<typeof listedBrandSchema>;
const brandListSchema = z.object({ brands: z.array(listedBrandSchema) });

export const PRODUCT_TYPES = [
  'AYURVEDIC_MEDICINE',
  'FOOD_OR_SUPPLEMENT',
  'COSMETIC',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const PRODUCT_TYPE_NAMES: Record<ProductType, string> = {
  AYURVEDIC_MEDICINE: 'Ayurvedic medicine',
  FOOD_OR_SUPPLEMENT: 'Food or supplement',
  COSMETIC: 'Cosmetic',
};
// In percent: the rates the law allows today (ADR 0022).
export const GST_RATES = [0, 5, 18, 40] as const;

export const productSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  ingredients: z.string().nullable(),
  usage: z.string().nullable(),
  type: z.enum(PRODUCT_TYPES).nullable(),
  licenceNumber: z.string().nullable(),
  manufacturerName: z.string().nullable(),
  manufacturerAddress: z.string().nullable(),
  countryOfOrigin: z.string(),
  hsnCode: z.string().nullable(),
  gstRate: z.number().int().nullable(),
  isActive: z.boolean(),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;
const productPageSchema = z.object({
  products: z.array(productSchema),
  nextAfter: z.string().nullable(),
});
export type ProductPage = z.infer<typeof productPageSchema>;
const productListSchema = z.object({ products: z.array(productSchema) });

// What staff can set on a category or a product. An empty text field is
// sent as null, which the API reads as "none".
export interface CategoryFields {
  name: string;
  slug?: string;
  description?: string | null;
  isActive?: boolean;
  // null: a top category.
  parentId?: string | null;
}
export interface BrandFields {
  name: string;
  slug?: string;
}
export type ProductFields = Omit<
  Product,
  'id' | 'position' | 'createdAt' | 'updatedAt'
>;
// What a product's create or change sends: its fields, and where it goes
// in its category.
export type ProductInput = Partial<ProductFields> & { position?: number };

export interface ProductQuery {
  categoryId?: string | undefined;
  brandId?: string | undefined;
  isActive?: boolean | undefined;
  // Words in the name; the best matches come back on one page.
  q?: string | undefined;
  after?: string | undefined;
  limit?: number | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whether a value from the address bar can be an ID at all.
export function isId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}

// The highest position the API takes.
export const MAX_POSITION = 9999;

// An ID put into a path is a UUID and nothing else. A product's page takes
// its ID from the address bar, so "..", "/" or "?" must never reach the
// path: such an ID is a product that does not exist. (The functions that
// use it are async, so this comes back as a rejected promise too.)
export function idInPath(base: string, id: string): string {
  if (!isId(id)) {
    throw new ApiError(404, 'There is no such item.');
  }
  return `${base}/${id}`;
}

export async function listCategories(signal?: AbortSignal) {
  const { categories } = await apiRequest(CATEGORIES, {
    schema: categoryListSchema,
    signal,
  });
  return categories;
}

export function createCategory(input: CategoryFields) {
  return apiRequest(CATEGORIES, {
    method: 'POST',
    body: input,
    schema: categorySchema,
  });
}

export async function updateCategory(
  id: string,
  changes: Partial<CategoryFields>,
) {
  return apiRequest(idInPath(CATEGORIES, id), {
    method: 'PATCH',
    body: changes,
    schema: categorySchema,
  });
}

// Super Users only; the API refuses Admins.
export async function deleteCategory(id: string) {
  return apiRequest(idInPath(CATEGORIES, id), { method: 'DELETE' });
}

// One level, first to last: the top categories, or the subcategories of
// the top category parentId (part 15A). Answers every category.
export async function reorderCategories(
  ids: string[],
  parentId: string | null = null,
) {
  const { categories } = await apiRequest(`${CATEGORIES}/order`, {
    method: 'PUT',
    body: parentId ? { parentId, ids } : { ids },
    schema: categoryListSchema,
  });
  return categories;
}

// Every brand, by name, with how many products have each.
export async function listBrands(signal?: AbortSignal) {
  const { brands } = await apiRequest(BRANDS, {
    schema: brandListSchema,
    signal,
  });
  return brands;
}

export function createBrand(input: BrandFields) {
  return apiRequest(BRANDS, {
    method: 'POST',
    body: input,
    schema: brandSchema,
  });
}

export async function updateBrand(id: string, changes: Partial<BrandFields>) {
  return apiRequest(idInPath(BRANDS, id), {
    method: 'PATCH',
    body: changes,
    schema: brandSchema,
  });
}

// Super Users only; the API refuses Admins.
export async function deleteBrand(id: string) {
  return apiRequest(idInPath(BRANDS, id), { method: 'DELETE' });
}

export function listProducts(query: ProductQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.categoryId) {
    params.set('categoryId', query.categoryId);
  }
  if (query.brandId) {
    params.set('brandId', query.brandId);
  }
  if (query.isActive !== undefined) {
    params.set('isActive', String(query.isActive));
  }
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.after) {
    params.set('after', query.after);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  const search = params.toString();
  return apiRequest(search ? `${PRODUCTS}?${search}` : PRODUCTS, {
    schema: productPageSchema,
    signal,
  });
}

export async function getProduct(id: string, signal?: AbortSignal) {
  return apiRequest(idInPath(PRODUCTS, id), { schema: productSchema, signal });
}

export function createProduct(input: ProductInput) {
  return apiRequest(PRODUCTS, {
    method: 'POST',
    body: input,
    schema: productSchema,
  });
}

export async function updateProduct(id: string, changes: ProductInput) {
  return apiRequest(idInPath(PRODUCTS, id), {
    method: 'PATCH',
    body: changes,
    schema: productSchema,
  });
}

// Super Users only; the API refuses Admins.
export async function deleteProduct(id: string) {
  return apiRequest(idInPath(PRODUCTS, id), { method: 'DELETE' });
}

// Where a product put into a category goes: after its last one. The list
// comes first to last, so the last product of the last page is the last.
export async function nextProductPosition(categoryId: string) {
  let after: string | undefined;
  let last = -1;
  do {
    const page = await listProducts({ categoryId, after, limit: 100 });
    last = page.products.at(-1)?.position ?? last;
    after = page.nextAfter ?? undefined;
  } while (after);
  return Math.min(MAX_POSITION, last + 1);
}

// Every product shown in one category, drafts too, first to last (part
// 15A): those whose main category it is, and those also shown in it.
export async function listProductOrder(
  categoryId: string,
  signal?: AbortSignal,
) {
  const search = new URLSearchParams({ categoryId }).toString();
  const { products } = await apiRequest(`${PRODUCTS}/order?${search}`, {
    schema: productListSchema,
    signal,
  });
  return products;
}

// Every product of one category, first to last.
export async function reorderProducts(categoryId: string, ids: string[]) {
  const { products } = await apiRequest(`${PRODUCTS}/order`, {
    method: 'PUT',
    body: { categoryId, ids },
    schema: productListSchema,
  });
  return products;
}

// Pack sizes (ADR 0022): the net quantity on the label, in its unit, and
// its prices in whole rupees.
export const PACK_UNITS = [
  'G',
  'KG',
  'ML',
  'L',
  'CAPSULES',
  'TABLETS',
  'PIECES',
] as const;
export type PackUnit = (typeof PACK_UNITS)[number];
export const PACK_UNIT_NAMES: Record<PackUnit, string> = {
  G: 'g',
  KG: 'kg',
  ML: 'ml',
  L: 'L',
  CAPSULES: 'capsules',
  TABLETS: 'tablets',
  PIECES: 'pieces',
};

export const variantSchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string(),
  quantity: z.number().int(),
  unit: z.enum(PACK_UNITS),
  mrpRupees: z.number().int(),
  priceRupees: z.number().int(),
  isActive: z.boolean(),
  // Staff see its stock as low at this many packs that may be sold, or
  // fewer; 0 never (ADR 0034).
  lowStockAt: z.number().int(),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Variant = z.infer<typeof variantSchema>;
const variantListSchema = z.object({ variants: z.array(variantSchema) });

// What staff set on a pack size. It is on sale unless isActive is false.
export type VariantFields = Pick<
  Variant,
  | 'sku'
  | 'quantity'
  | 'unit'
  | 'mrpRupees'
  | 'priceRupees'
  | 'isActive'
  | 'lowStockAt'
>;

// A product's pack sizes, off sale ones too, first to last.
export async function listVariants(productId: string, signal?: AbortSignal) {
  const { variants } = await apiRequest(
    `${idInPath(PRODUCTS, productId)}/variants`,
    { schema: variantListSchema, signal },
  );
  return variants;
}

export async function createVariant(
  productId: string,
  input: VariantFields & { position?: number },
) {
  return apiRequest(`${idInPath(PRODUCTS, productId)}/variants`, {
    method: 'POST',
    body: input,
    schema: variantSchema,
  });
}

export async function updateVariant(
  id: string,
  changes: Partial<VariantFields>,
) {
  return apiRequest(idInPath(VARIANTS, id), {
    method: 'PATCH',
    body: changes,
    schema: variantSchema,
  });
}

// Super Users only; the API refuses Admins, and a pack size with stock.
export async function deleteVariant(id: string) {
  return apiRequest(idInPath(VARIANTS, id), { method: 'DELETE' });
}

// Every pack size of the product, off sale ones too, first to last.
export async function reorderVariants(productId: string, ids: string[]) {
  const { variants } = await apiRequest(
    `${idInPath(PRODUCTS, productId)}/variants/order`,
    { method: 'PUT', body: { ids }, schema: variantListSchema },
  );
  return variants;
}

// Images (ADR 0023): the API re-encodes each upload into two WebP files,
// and answers their addresses. Only http and https addresses are shown.
const mediaUrl = z.url({ protocol: /^https?$/ });

export const imageSchema = z.object({
  id: z.string(),
  productId: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  altText: z.string().nullable(),
  position: z.number().int(),
  url: mediaUrl,
  thumbnailUrl: mediaUrl,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductImage = z.infer<typeof imageSchema>;
const imageListSchema = z.object({ images: z.array(imageSchema) });

// What the API takes (ADR 0023): at most 6 images a product, each a JPEG,
// PNG or WebP of at most 10 MB.
export const MAX_IMAGES = 6;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Why a file cannot be uploaded as it is, or null when it can. The API
// checks it again, and checks the picture itself (at least 400 pixels on
// each side).
export function imageFileProblem(file: File): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    // iPhones save photos as HEIC unless set to "Most Compatible".
    return /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name)
      ? 'HEIC photos cannot be used. Save it as a JPEG first.'
      : 'Choose a JPEG, PNG or WebP image.';
  }
  if (file.size === 0) {
    return 'The file is empty.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    // Rounded up, so a file just over the limit never reads as 10.0 MB.
    const megabytes = (
      Math.ceil((file.size * 10) / (1024 * 1024)) / 10
    ).toFixed(1);
    return `The file is ${megabytes} MB. An image may be at most 10 MB.`;
  }
  return null;
}

// A product's images, the main photo first.
export async function listImages(productId: string, signal?: AbortSignal) {
  const { images } = await apiRequest(
    `${idInPath(PRODUCTS, productId)}/images`,
    { schema: imageListSchema, signal },
  );
  return images;
}

// Uploads one image; it goes after the product's last one. A file the API
// would refuse is not sent.
export async function uploadImage(
  productId: string,
  file: File,
  options: { onProgress?: (sent: number) => void; signal?: AbortSignal } = {},
) {
  const path = `${idInPath(PRODUCTS, productId)}/images`;
  const problem = imageFileProblem(file);
  if (problem) {
    const status = !(IMAGE_TYPES as readonly string[]).includes(file.type)
      ? 415
      : file.size > MAX_IMAGE_BYTES
        ? 413
        : 400;
    throw new ApiError(status, problem);
  }
  return apiUpload(path, file, { ...options, schema: imageSchema });
}

// An image's description, for people who cannot see it. Empty is none.
export async function updateImage(
  id: string,
  changes: { altText: string | null },
) {
  return apiRequest(idInPath(IMAGES, id), {
    method: 'PATCH',
    body: changes,
    schema: imageSchema,
  });
}

// Admins may too (ADR 0023). The API refuses the last image of a live
// product.
export async function deleteImage(id: string) {
  return apiRequest(idInPath(IMAGES, id), { method: 'DELETE' });
}

// Every image of the product, first to last: the first is the main photo.
export async function reorderImages(productId: string, ids: string[]) {
  const { images } = await apiRequest(
    `${idInPath(PRODUCTS, productId)}/images/order`,
    { method: 'PUT', body: { ids }, schema: imageListSchema },
  );
  return images;
}
