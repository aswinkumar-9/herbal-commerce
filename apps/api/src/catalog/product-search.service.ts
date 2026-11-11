import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { StockService } from '../inventory/stock.service';
import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';
import { IMAGE_ORDER, imageFileNames } from './image-files';
import type { ProductSearchQuery, SearchSort } from './product-search.schemas';

// At most this many products are weighed for one search: the shop's
// catalog is small, so all of them, today. Revisit when the shop has a few
// thousand live products (ADR 0030).
export const SEARCH_CANDIDATES = 500;

// What the search reads of each product: its packs on sale, for the
// lowest price and the stock, and its main photo.
const SEARCH_FIELDS = {
  id: true,
  name: true,
  slug: true,
  summary: true,
  variants: {
    where: { isActive: true },
    select: { id: true, priceRupees: true },
  },
  images: { orderBy: IMAGE_ORDER, take: 1, select: { fileKey: true } },
} satisfies Prisma.ProductSelect;

// A product found, as a category's page shows it, and whether any of its
// packs on sale is in stock.
export interface SearchCard {
  name: string;
  slug: string;
  summary: string | null;
  fromPriceRupees: number | null;
  imageUrl: string | null;
  inStock: boolean;
}

export interface SearchPage {
  products: SearchCard[];
  // How many products were found, on every page.
  total: number;
  page: number;
  nextPage: number | null;
}

// A product found, and how well it matches the search words.
interface Found {
  card: SearchCard;
  score: number;
}

// Lowest first, or highest first; a product with no pack on sale last.
function byPrice(a: number | null, b: number | null, direction: 1 | -1) {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return (a - b) * direction;
}

const ORDERS: Record<SearchSort, (a: Found, b: Found) => number> = {
  relevance: (a, b) => b.score - a.score,
  'price-asc': (a, b) =>
    byPrice(a.card.fromPriceRupees, b.card.fromPriceRupees, 1),
  'price-desc': (a, b) =>
    byPrice(a.card.fromPriceRupees, b.card.fromPriceRupees, -1),
  name: () => 0,
};

// Then by name, and by slug, which is unique: the same search always
// answers in the same order, so its pages never overlap.
function byName(a: SearchCard, b: SearchCard): number {
  return (
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
  );
}

// The shop's search (ADR 0030): live products in active categories, found
// by words in their name, summary or description, even partial or
// misspelt, and filtered by category, type and lowest price. Products in
// stock come first, then by the order asked for, then by name. The search
// words are never stored or logged.
@Injectable()
export class ProductSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly media: MediaStorage,
  ) {}

  async search(query: ProductSearchQuery): Promise<SearchPage> {
    const scores = query.q ? await this.matches(query.q) : null;
    const rows =
      scores?.size === 0
        ? []
        : await this.prisma.product.findMany({
            where: {
              isActive: true,
              category: {
                isActive: true,
                ...(query.category ? { slug: query.category } : {}),
              },
              ...(query.type ? { type: query.type } : {}),
              ...(scores ? { id: { in: [...scores.keys()] } } : {}),
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: SEARCH_CANDIDATES,
            select: SEARCH_FIELDS,
          });
    // The inventory says which packs are in stock (ADR 0024).
    const inStock = await this.stock.inStock(
      rows.flatMap((row) => row.variants.map((variant) => variant.id)),
    );
    const found = rows
      .map(({ id, variants, images, ...product }): Found => {
        const prices = variants.map((variant) => variant.priceRupees);
        return {
          card: {
            ...product,
            fromPriceRupees: prices.length > 0 ? Math.min(...prices) : null,
            // A live product always has an image; null only guards the type.
            imageUrl: images[0]
              ? this.media.url(imageFileNames(images[0].fileKey).small)
              : null,
            inStock: variants.some((variant) => inStock.has(variant.id)),
          },
          score: scores?.get(id) ?? 0,
        };
      })
      .filter(({ card }) => this.inPriceRange(card, query))
      .sort(
        (a, b) =>
          Number(b.card.inStock) - Number(a.card.inStock) ||
          ORDERS[query.sort](a, b) ||
          byName(a.card, b.card),
      );
    const start = (query.page - 1) * query.limit;
    return {
      products: found.slice(start, start + query.limit).map(({ card }) => card),
      total: found.length,
      page: query.page,
      nextPage: found.length > start + query.limit ? query.page + 1 : null,
    };
  }

  // The live products whose name, summary or description has a word like
  // the search words, each with how well it matches: the name counts most.
  // pg_trgm compares three-letter pieces, so "ashwa" and "ashwaganda" both
  // find Ashwagandha. The words are a bound parameter, never part of the
  // SQL.
  private async matches(words: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ id: string; score: number }[]>`
      SELECT p."id", GREATEST(
               word_similarity(${words}, p."name"),
               word_similarity(${words}, COALESCE(p."summary", '')) * 0.8,
               word_similarity(${words}, COALESCE(p."description", '')) * 0.6
             )::float8 AS "score"
        FROM "products" p
        JOIN "categories" c ON c."id" = p."categoryId"
       WHERE p."isActive" AND c."isActive"
         AND (${words} <% p."name"
              OR ${words} <% p."summary"
              OR ${words} <% p."description")
       ORDER BY "score" DESC, p."id"
       LIMIT ${SEARCH_CANDIDATES}`;
    return new Map(rows.map((row) => [row.id, row.score]));
  }

  // A price filter keeps the products whose lowest price on sale is within
  // it, so never one with no pack on sale.
  private inPriceRange(
    { fromPriceRupees: price }: SearchCard,
    { minPriceRupees: min, maxPriceRupees: max }: ProductSearchQuery,
  ): boolean {
    if (min === undefined && max === undefined) {
      return true;
    }
    return (
      price !== null &&
      (min === undefined || price >= min) &&
      (max === undefined || price <= max)
    );
  }
}
