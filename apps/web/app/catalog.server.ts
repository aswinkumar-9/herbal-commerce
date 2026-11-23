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

// A product's own page: what it is, its packs on sale with their prices
// and whether each can be bought, its photos, and the licence and maker
// details Indian labelling rules want shown.
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

const webAddress = z.url({ protocol: /^https?$/ });
const productSchema = z.object({
  name: z.string().min(1),
  slug,
  summary: z.string().nullable(),
  description: z.string().nullable(),
  ingredients: z.string().min(1),
  usage: z.string().nullable(),
  type: z.enum(['AYURVEDIC_MEDICINE', 'FOOD_OR_SUPPLEMENT', 'COSMETIC']),
  licenceNumber: z.string().min(1),
  manufacturerName: z.string().min(1),
  manufacturerAddress: z.string().min(1),
  countryOfOrigin: z.string().min(1),
  category: z.object({ name: z.string().min(1), slug }),
  variants: z.array(
    z.object({
      sku: z.string().min(1),
      quantity: z.number().int().min(1),
      unit: z.enum(PACK_UNITS),
      mrpRupees: z.number().int().min(0),
      priceRupees: z.number().int().min(0),
      inStock: z.boolean(),
    }),
  ),
  images: z.array(
    z.object({
      url: webAddress,
      thumbnailUrl: webAddress,
      altText: z.string(),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
    }),
  ),
});
export type Product = z.infer<typeof productSchema>;
export type ProductImage = Product['images'][number];
export type Pack = Product['variants'][number];

// A picture shows only from the shop's media address, the one place the
// page's policy lets pictures come from (img-src). Any other is left out:
// the page shows no photo rather than a broken one.
export function onMedia(address: string): string | null {
  // Both as the browser reads them, with any "/../" worked out.
  const url = new URL(address).href;
  const media = new URL(mediaSource(getConfig().mediaBaseUrl)).href;
  return url.startsWith(media) ? url : null;
}

function fromMedia<T extends { imageUrl: string | null }>(card: T): T {
  return card.imageUrl === null
    ? card
    : { ...card, imageUrl: onMedia(card.imageUrl) };
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

// A live product's own page. An unknown, draft or hidden one is "not
// found". A photo whose files aren't both at the media address is left out.
export async function getProduct(
  request: Request,
  productSlug: string,
): Promise<Product> {
  const product = await apiGet(
    request,
    `products/${segment(productSlug)}`,
    productSchema,
  );
  const images: ProductImage[] = [];
  for (const image of product.images) {
    const url = onMedia(image.url);
    const thumbnailUrl = onMedia(image.thumbnailUrl);
    if (url && thumbnailUrl) {
      images.push({ ...image, url, thumbnailUrl });
    }
  }
  return { ...product, images };
}
