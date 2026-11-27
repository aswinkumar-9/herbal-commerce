import { isId } from '../catalog/catalog-api';
import type { Brand, Category } from '../catalog/catalog-api';
import { categoryLabel } from '../catalog/category-tree';
import { PAYMENT_METHODS } from './sales-api';

// What the Sales page may be narrowed to (part 15D, ADR 0047): a product, a
// category (a top one with its subcategories, or a subcategory) and a
// brand, and since part 15E the state the orders went to and how they were
// paid, together or apart. The catalog's by ID, all in the address as the
// API takes them, so a link shows the same sales.

export const FILTER_KINDS = [
  'product',
  'category',
  'brand',
  'state',
  'method',
] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

export const FILTER_PARAMS: Record<FilterKind, string> = {
  product: 'productId',
  category: 'categoryId',
  brand: 'brandId',
  state: 'state',
  method: 'method',
};

export const FILTER_NAMES: Record<FilterKind, string> = {
  product: 'Product',
  category: 'Category',
  brand: 'Brand',
  state: 'State',
  method: 'Payment method',
};

// The payments made before part 15C, which kept no method.
export const NOT_RECORDED_METHOD = 'NOT_RECORDED';
// Read when asked, not as this file loads: the API's file needs this one.
const isMethod = (method: string) =>
  method === NOT_RECORDED_METHOD ||
  (PAYMENT_METHODS as readonly string[]).includes(method);

export type SalesFilter = Partial<Record<FilterKind, string>>;

// The filter the address asks for: anything that can't be an ID or a way of
// paying is left out, as a link from before might have it. A state is kept
// as written: the API knows India's states, and says so of one it doesn't.
export function filterFrom(params: URLSearchParams): SalesFilter {
  const filter: SalesFilter = {};
  for (const kind of ['product', 'category', 'brand'] as const) {
    const id = params.get(FILTER_PARAMS[kind]);
    if (isId(id)) {
      filter[kind] = id.toLowerCase();
    }
  }
  const state = params.get('state')?.trim();
  if (state && state.length <= 60) {
    filter.state = state;
  }
  const method = params.get('method');
  if (method && isMethod(method)) {
    filter.method = method;
  }
  return filter;
}

export const isFiltered = (filter: SalesFilter) =>
  FILTER_KINDS.some((kind) => filter[kind] !== undefined);

// Narrowed to some products: every figure is theirs alone, and delivery,
// charged on whole orders, is not split.
export const keepsProducts = (filter: SalesFilter) =>
  filter.product !== undefined ||
  filter.category !== undefined ||
  filter.brand !== undefined;

// The filter as the address and the API take it.
export function filterParams(filter: SalesFilter): Record<string, string> {
  const params: Record<string, string> = {};
  for (const kind of FILTER_KINDS) {
    const id = filter[kind];
    if (id) {
      params[FILTER_PARAMS[kind]] = id;
    }
  }
  return params;
}

export interface FilterMatch {
  kind: FilterKind;
  id: string;
  name: string;
}

// How many of each kind a search offers.
export const MATCHES_SHOWN = 5;

const folded = (text: string) => text.toLocaleLowerCase('en-IN');

// The categories and brands whose names hold the words, the closest first:
// those that start with them, then by name. A subcategory is named with
// its top category: "Hair Care › Hair Oils".
export function catalogMatches(
  words: string,
  categories: readonly Category[],
  brands: readonly Brand[],
): FilterMatch[] {
  const wanted = folded(words.trim());
  if (!wanted) {
    return [];
  }
  const best = (found: FilterMatch[], names: Map<string, string>) =>
    found
      .filter((match) => folded(names.get(match.id) ?? '').includes(wanted))
      .sort((a, b) => {
        const aStarts = folded(names.get(a.id) ?? '').startsWith(wanted);
        const bStarts = folded(names.get(b.id) ?? '').startsWith(wanted);
        return aStarts === bStarts
          ? a.name.localeCompare(b.name)
          : aStarts
            ? -1
            : 1;
      })
      .slice(0, MATCHES_SHOWN);
  return [
    ...best(
      categories.map((category) => ({
        kind: 'category' as const,
        id: category.id,
        name: categoryLabel(categories, category),
      })),
      new Map(categories.map((category) => [category.id, category.name])),
    ),
    ...best(
      brands.map((brand) => ({
        kind: 'brand' as const,
        id: brand.id,
        name: brand.name,
      })),
      new Map(brands.map((brand) => [brand.id, brand.name])),
    ),
  ];
}
