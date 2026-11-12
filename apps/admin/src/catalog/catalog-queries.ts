import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getProduct, listCategories, listProducts } from './catalog-api';
import type { ProductQuery } from './catalog-api';

// Where the console keeps each catalog answer. A change invalidates
// catalogKeys.all, or the part it touched.
export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => ['catalog', 'categories'] as const,
  productLists: () => ['catalog', 'products'] as const,
  products: (query: Omit<ProductQuery, 'after'>) =>
    ['catalog', 'products', query] as const,
  product: (id: string) => ['catalog', 'product', id] as const,
};

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => listCategories(signal),
  });
}

// Products one page at a time: each page's nextAfter asks for the next.
// A search comes back on one page.
export function useProductPages(query: Omit<ProductQuery, 'after'>) {
  return useInfiniteQuery({
    queryKey: catalogKeys.products(query),
    queryFn: ({ pageParam, signal }) =>
      listProducts({ ...query, after: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextAfter ?? undefined,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: catalogKeys.product(id),
    queryFn: ({ signal }) => getProduct(id, signal),
  });
}
