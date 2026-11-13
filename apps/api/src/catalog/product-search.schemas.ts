import { z } from 'zod';
import { ProductType } from '../generated/prisma/enums';
import { slugSchema } from './slug';

// The ways search results can be put in order (ADR 0030). Products in
// stock always come first.
export const SEARCH_SORTS = [
  'relevance',
  'price-asc',
  'price-desc',
  'name',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

// The highest price a filter may name, in rupees: far above any pack's.
const MAX_PRICE_RUPEES = 1_000_000;

// The search words, with each run of spaces made one. Empty means none.
// Staff search the product list with the same rule (ADR 0032).
export const searchWords = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .max(100, 'Search with at most 100 characters')
      .refine(
        (value) => value === '' || value.length >= 2,
        'Search with at least 2 characters',
      ),
  )
  .transform((value) => value || undefined);

const price = z.coerce
  .number('Give a price in whole rupees')
  .int('Give a price in whole rupees')
  .min(0, 'Give a price in whole rupees')
  .max(MAX_PRICE_RUPEES, 'Give a price of at most Rs 10,00,000');

// What customers may ask of the shop's search: words, filters, an order,
// and a page. Each filter works without words too.
export const productSearchQuerySchema = z
  .object({
    q: searchWords.optional(),
    category: slugSchema.optional(),
    type: z
      .enum(
        ProductType,
        'Choose AYURVEDIC_MEDICINE, FOOD_OR_SUPPLEMENT or COSMETIC',
      )
      .optional(),
    minPriceRupees: price.optional(),
    maxPriceRupees: price.optional(),
    sort: z
      .enum(SEARCH_SORTS, 'Choose relevance, price-asc, price-desc or name')
      .optional(),
    page: z.coerce
      .number()
      .int()
      .min(1, 'Pages start at 1')
      .max(100, 'Give a page of at most 100')
      .default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((query, context) => {
    if (
      query.minPriceRupees !== undefined &&
      query.maxPriceRupees !== undefined &&
      query.minPriceRupees > query.maxPriceRupees
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minPriceRupees'],
        message: 'The lowest price is above the highest',
      });
    }
    if (query.sort === 'relevance' && !query.q) {
      context.addIssue({
        code: 'custom',
        path: ['sort'],
        message: 'Sorting by relevance needs search words',
      });
    }
  })
  // With words, the best matches first; without, by name.
  .transform(({ sort, ...query }) => ({
    ...query,
    sort: sort ?? (query.q ? 'relevance' : 'name'),
  }));
export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;
