import { z } from 'zod';
import { ApiError } from '../api/api-error';
import { apiRequest } from '../api/client';

// The staff catalog API (ADR 0020 to 0023, and 0031 for ordering): what the
// console reads and sends. Every answer is checked against these shapes.

const CATEGORIES = '/v1/staff/categories';
const PRODUCTS = '/v1/staff/products';

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Category = z.infer<typeof categorySchema>;
const categoryListSchema = z.object({ categories: z.array(categorySchema) });

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
function idInPath(base: string, id: string): string {
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

// Every category, first to last.
export async function reorderCategories(ids: string[]) {
  const { categories } = await apiRequest(`${CATEGORIES}/order`, {
    method: 'PUT',
    body: { ids },
    schema: categoryListSchema,
  });
  return categories;
}

export function listProducts(query: ProductQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.categoryId) {
    params.set('categoryId', query.categoryId);
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

// Every product of one category, first to last.
export async function reorderProducts(categoryId: string, ids: string[]) {
  const { products } = await apiRequest(`${PRODUCTS}/order`, {
    method: 'PUT',
    body: { categoryId, ids },
    schema: productListSchema,
  });
  return products;
}
