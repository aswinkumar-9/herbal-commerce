// What the shop page's address asks for (part 14A): search words, a
// category, a brand (part 15B), a type, a price range, an order and a page. An address can
// come from anywhere, so each part is checked here as the API checks it
// (ADR 0030), and a part the API would refuse is left out: the API is
// never asked what it would answer with an error. The parts a customer
// types (the words and the prices) say what was wrong; the others are
// dropped quietly, as only an edited address holds a wrong one.
import { text } from './text/en.ts';

// Four rows of products on a wide screen, three or two on smaller ones.
export const PAGE_SIZE = 24;
// The API's limits.
export const LAST_PAGE = 100;
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
export const PRICE_MAX = 1_000_000;
const SLUG_MAX = 60;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isSlug = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.length <= SLUG_MAX && SLUG.test(value);

// The product types, as the address names them and as the API does.
export const PRODUCT_TYPES = {
  'ayurvedic-medicine': 'AYURVEDIC_MEDICINE',
  'food-or-supplement': 'FOOD_OR_SUPPLEMENT',
  cosmetic: 'COSMETIC',
} as const;
export type ProductTypeKey = keyof typeof PRODUCT_TYPES;
export const TYPE_KEYS = Object.keys(PRODUCT_TYPES) as ProductTypeKey[];

// The address's name for one of the API's types.
export const typeKeyOf = (
  type: (typeof PRODUCT_TYPES)[ProductTypeKey],
): ProductTypeKey =>
  TYPE_KEYS.find((key) => PRODUCT_TYPES[key] === type) ?? 'cosmetic';

export const SORTS = ['relevance', 'price-asc', 'price-desc', 'name'] as const;
export type Sort = (typeof SORTS)[number];

export interface ShopSearch {
  q?: string | undefined;
  category?: string | undefined;
  brand?: string | undefined;
  type?: ProductTypeKey | undefined;
  min?: number | undefined;
  max?: number | undefined;
  // Only an order other than the usual one for the words.
  sort?: Sort | undefined;
  page: number;
}

// What was wrong with what the customer typed.
export interface SearchProblems {
  q?: string;
  min?: string;
  max?: string;
}

// The words and prices as typed, for the form to show again with what was
// wrong, cut short if an address held far too much.
export interface Typed {
  q: string;
  min: string;
  max: string;
}

// With words, the best matches first; without, by name.
export const usualSort = (q?: string): Sort => (q ? 'relevance' : 'name');
export const sortOf = (search: ShopSearch): Sort =>
  search.sort ?? usualSort(search.q);

const problems = text.shopPage.problems;

function field(params: URLSearchParams, name: string): string {
  return (params.get(name) ?? '').trim().slice(0, 200);
}

// A price in whole rupees: undefined when none was given, false when what
// was given is not one.
function price(value: string): number | undefined | false {
  if (value === '') {
    return undefined;
  }
  if (!/^\d{1,7}$/.test(value)) {
    return false;
  }
  const rupees = Number(value);
  return rupees <= PRICE_MAX ? rupees : false;
}

export function readShopSearch(params: URLSearchParams): {
  search: ShopSearch;
  problems: SearchProblems;
  typed: Typed;
} {
  const found: SearchProblems = {};
  // Each run of spaces made one, as the API does.
  const words = field(params, 'q').replace(/\s+/g, ' ');
  let q: string | undefined;
  if (words.length > SEARCH_MAX) {
    found.q = problems.long;
  } else if (words.length > 0 && words.length < SEARCH_MIN) {
    found.q = problems.short;
  } else if (words) {
    q = words;
  }

  const typedMin = field(params, 'min').slice(0, 16);
  const typedMax = field(params, 'max').slice(0, 16);
  let min = price(typedMin);
  let max = price(typedMax);
  if (min === false) {
    found.min = problems.price;
    min = undefined;
  }
  if (max === false) {
    found.max = problems.price;
    max = undefined;
  }
  if (min !== undefined && max !== undefined && min > max) {
    found.max = problems.range;
    min = undefined;
    max = undefined;
  }

  const category = field(params, 'category');
  const brand = field(params, 'brand');
  const type = field(params, 'type');
  const sort = field(params, 'sort');
  const page = field(params, 'page');
  const chosen = (SORTS as readonly string[]).includes(sort)
    ? (sort as Sort)
    : undefined;
  const pageNumber = /^\d{1,3}$/.test(page) ? Number(page) : 1;

  return {
    search: {
      q,
      category: isSlug(category) ? category : undefined,
      brand: isSlug(brand) ? brand : undefined,
      // Its own keys only: never one every object has, like "constructor".
      type: Object.hasOwn(PRODUCT_TYPES, type)
        ? (type as ProductTypeKey)
        : undefined,
      min,
      max,
      sort:
        chosen && chosen !== usualSort(q) && !(chosen === 'relevance' && !q)
          ? chosen
          : undefined,
      page: pageNumber >= 1 && pageNumber <= LAST_PAGE ? pageNumber : 1,
    },
    problems: found,
    typed: { q: words, min: typedMin, max: typedMax },
  };
}

// The question for the API's search (GET /v1/products).
export function apiQuery(search: ShopSearch): URLSearchParams {
  const query = new URLSearchParams();
  if (search.q) {
    query.set('q', search.q);
  }
  if (search.category) {
    query.set('category', search.category);
  }
  if (search.brand) {
    query.set('brand', search.brand);
  }
  if (search.type) {
    query.set('type', PRODUCT_TYPES[search.type]);
  }
  if (search.min !== undefined) {
    query.set('minPriceRupees', String(search.min));
  }
  if (search.max !== undefined) {
    query.set('maxPriceRupees', String(search.max));
  }
  query.set('sort', sortOf(search));
  query.set('page', String(search.page));
  query.set('limit', String(PAGE_SIZE));
  return query;
}

// The shop's address for a search with some parts changed, as short as it
// can be. Any change but the page's starts again from the first page.
export function shopHref(
  search: ShopSearch,
  change: Partial<ShopSearch> = {},
): string {
  const next: ShopSearch = { ...search, page: 1, ...change };
  const params = new URLSearchParams();
  if (next.q) {
    params.set('q', next.q);
  }
  if (next.category) {
    params.set('category', next.category);
  }
  if (next.brand) {
    params.set('brand', next.brand);
  }
  if (next.type) {
    params.set('type', next.type);
  }
  if (next.min !== undefined) {
    params.set('min', String(next.min));
  }
  if (next.max !== undefined) {
    params.set('max', String(next.max));
  }
  if (
    next.sort &&
    next.sort !== usualSort(next.q) &&
    !(next.sort === 'relevance' && !next.q)
  ) {
    params.set('sort', next.sort);
  }
  if (next.page > 1) {
    params.set('page', String(next.page));
  }
  const query = params.toString();
  return query ? `/shop?${query}` : '/shop';
}

// How many filters are in use: the category, the brand, the type, and the
// price range as one.
export function filtersInUse(search: ShopSearch): number {
  return (
    Number(search.category !== undefined) +
    Number(search.brand !== undefined) +
    Number(search.type !== undefined) +
    Number(search.min !== undefined || search.max !== undefined)
  );
}
