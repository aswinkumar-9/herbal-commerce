import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { getProduct, listCategories, listProducts } from './catalog-api';
import type { Category, ProductQuery } from './catalog-api';

// Where the console keeps each catalog answer. A change invalidates
// catalogKeys.all, or the part it touched.
export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => ['catalog', 'categories'] as const,
  productLists: () => ['catalog', 'products'] as const,
  products: (query: Omit<ProductQuery, 'after'>) =>
    ['catalog', 'products', query] as const,
  product: (id: string) => ['catalog', 'product', id] as const,
  // Whether a category has any product, drafts too (under productLists, so
  // a product change refreshes it).
  categoryHasProducts: (categoryId: string) =>
    ['catalog', 'products', 'any', categoryId] as const,
};

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => listCategories(signal),
  });
}

// Products one page at a time: each page's nextAfter asks for the next.
// A search comes back on one page. While another filter loads, the last
// list stays (isPlaceholderData says so).
export function useProductPages(query: Omit<ProductQuery, 'after'>) {
  return useInfiniteQuery({
    queryKey: catalogKeys.products(query),
    queryFn: ({ pageParam, signal }) =>
      listProducts({ ...query, after: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: catalogKeys.product(id),
    queryFn: ({ signal }) => getProduct(id, signal),
  });
}

// A category as the server now has it, in place in the cached list.
export function putCategory(queryClient: QueryClient, saved: Category): void {
  queryClient.setQueryData<Category[]>(catalogKeys.categories(), (list) =>
    list?.map((category) => (category.id === saved.id ? saved : category)),
  );
}

// A deleted category, out of the cached list.
export function dropCategory(queryClient: QueryClient, id: string): void {
  queryClient.setQueryData<Category[]>(catalogKeys.categories(), (list) =>
    list?.filter((category) => category.id !== id),
  );
}
