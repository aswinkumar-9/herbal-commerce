import { isId } from '../catalog/catalog-api';
import type { Brand, Category } from '../catalog/catalog-api';
import { categoryLabel } from '../catalog/category-tree';

// What the Sales page may be narrowed to (part 15D, ADR 0047): a product, a
// category (a top one with its subcategories, or a subcategory) and a
// brand, together or apart. Each by its ID, in the address as the API
// takes them, so a link shows the same sales.

export const FILTER_KINDS = ['product', 'category', 'brand'] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

export const FILTER_PARAMS: Record<FilterKind, string> = {
  product: 'productId',
  category: 'categoryId',
  brand: 'brandId',
};

export const FILTER_NAMES: Record<FilterKind, string> = {
  product: 'Product',
  category: 'Category',
  brand: 'Brand',
};

export type SalesFilter = Partial<Record<FilterKind, string>>;

// The filter the address asks for: anything that can't be an ID is left
// out, as a link from before might have it.
export function filterFrom(params: URLSearchParams): SalesFilter {
  const filter: SalesFilter = {};
  for (const kind of FILTER_KINDS) {
    const id = params.get(FILTER_PARAMS[kind]);
    if (isId(id)) {
      filter[kind] = id.toLowerCase();
    }
  }
  return filter;
}

export const isFiltered = (filter: SalesFilter) =>
  FILTER_KINDS.some((kind) => filter[kind] !== undefined);

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
