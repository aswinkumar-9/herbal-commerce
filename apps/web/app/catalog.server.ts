// The shop's catalog, as the API's public endpoints give it
// (docs/api-specification.md, "Categories" and "Products"). Answers are
// checked against these before a page uses them.
import { z } from 'zod';
import { apiGet, segment } from './api.server.ts';
import { getConfig } from './config.server.ts';
import { mediaSource } from './security-headers.ts';
import { PAGE_SIZE, apiQuery } from './shop-search.ts';
import type { ShopSearch } from './shop-search.ts';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const categorySchema = z.object({
  name: z.string().min(1),
  slug,
  description: z.string().nullable(),
});
export type Category = z.infer<typeof categorySchema>;

const categoriesSchema = z.object({ categories: z.array(categorySchema) });

// A product as a list shows it: its name, a line about it, its lowest
// price on sale (none when no pack is), and its main photo, small.
const cardFields = {
  name: z.string().min(1),
  slug,
  summary: z.string().nullable(),
  fromPriceRupees: z.number().int().min(0).nullable(),
  imageUrl: z.url({ protocol: /^https?$/ }).nullable(),
};

export interface ProductCard {
  name: string;
  slug: string;
  summary: string | null;
  fromPriceRupees: number | null;
  imageUrl: string | null;
  // Known from the search only: a category's list doesn't say.
  inStock?: boolean;
}

const searchSchema = z.object({
  products: z.array(z.object({ ...cardFields, inStock: z.boolean() })),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  nextPage: z.number().int().min(2).nullable(),
});
export type SearchPage = z.infer<typeof searchSchema>;

const categoryPageSchema = z.object({
  category: categorySchema,
  products: z.array(z.object(cardFields)),
  nextAfter: slug.nullable(),
});
export type CategoryPage = z.infer<typeof categoryPageSchema>;

// A picture shows only from the shop's media address, the one place the
// page's policy lets pictures come from (img-src). Any other is left out,
// and the card shows no photo rather than a broken one.
function fromMedia<T extends { imageUrl: string | null }>(card: T): T {
  if (card.imageUrl === null) {
    return card;
  }
  // Both as the browser reads them, with any "/../" worked out.
  const url = new URL(card.imageUrl).href;
  const media = new URL(mediaSource(getConfig().mediaBaseUrl)).href;
  return url.startsWith(media)
    ? { ...card, imageUrl: url }
    : { ...card, imageUrl: null };
}

// The categories customers see, in the order staff chose.
export async function listCategories(request: Request): Promise<Category[]> {
  const { categories } = await apiGet(request, 'categories', categoriesSchema);
  return categories;
}

// One page of the shop's search: products in stock first.
export async function searchProducts(
  request: Request,
  search: ShopSearch,
): Promise<SearchPage> {
  const found = await apiGet(
    request,
    'products',
    searchSchema,
    apiQuery(search),
  );
  return { ...found, products: found.products.map(fromMedia) };
}

// A category and one page of its products, in the order staff chose, from
// the one after `after`. An unknown or hidden category is "not found".
export async function listCategoryProducts(
  request: Request,
  categorySlug: string,
  after?: string,
): Promise<CategoryPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (after) {
    query.set('after', after);
  }
  const page = await apiGet(
    request,
    `categories/${segment(categorySlug)}/products`,
    categoryPageSchema,
    query,
  );
  return { ...page, products: page.products.map(fromMedia) };
}
