import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  getProduct,
  listBrands,
  listCategories,
  listImages,
  listProducts,
  listVariants,
} from './catalog-api';
import type {
  Brand,
  Category,
  ProductImage,
  ProductQuery,
  Variant,
} from './catalog-api';

// Where the console keeps each catalog answer. A change invalidates
// catalogKeys.all, or the part it touched.
export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => ['catalog', 'categories'] as const,
  brands: () => ['catalog', 'brands'] as const,
  productLists: () => ['catalog', 'products'] as const,
  products: (query: Omit<ProductQuery, 'after'>) =>
    ['catalog', 'products', query] as const,
  product: (id: string) => ['catalog', 'product', id] as const,
  // A product's pack sizes and images (under its product, so refreshing the
  // product refreshes them too).
  variants: (productId: string) =>
    ['catalog', 'product', productId, 'variants'] as const,
  images: (productId: string) =>
    ['catalog', 'product', productId, 'images'] as const,
  // Every product shown in a category, drafts too: its own and those also
  // shown in it (under productLists, so a product change refreshes it).
  productOrder: (categoryId: string) =>
    ['catalog', 'products', 'order', categoryId] as const,
  // The same for a brand (part 15A).
  brandHasProducts: (brandId: string) =>
    ['catalog', 'products', 'any-of-brand', brandId] as const,
};

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => listCategories(signal),
  });
}

// Every brand, by name (part 15A).
export function useBrands() {
  return useQuery({
    queryKey: catalogKeys.brands(),
    queryFn: ({ signal }) => listBrands(signal),
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

// Every pack size of a product, off sale ones too, first to last.
export function useVariants(productId: string) {
  return useQuery({
    queryKey: catalogKeys.variants(productId),
    queryFn: ({ signal }) => listVariants(productId, signal),
  });
}

// Every image of a product, the main photo first.
export function useImages(productId: string) {
  return useQuery({
    queryKey: catalogKeys.images(productId),
    queryFn: ({ signal }) => listImages(productId, signal),
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

// A brand as the server now has it, in place in the cached list. A change
// gives no product count back: the one in the list stays.
export function putBrand(
  queryClient: QueryClient,
  saved: Omit<Brand, 'productCount'>,
): void {
  queryClient.setQueryData<Brand[]>(catalogKeys.brands(), (list) =>
    list?.map((brand) =>
      brand.id === saved.id ? { ...brand, ...saved } : brand,
    ),
  );
}

// A deleted brand, out of the cached list.
export function dropBrand(queryClient: QueryClient, id: string): void {
  queryClient.setQueryData<Brand[]>(catalogKeys.brands(), (list) =>
    list?.filter((brand) => brand.id !== id),
  );
}

// A pack size as the server now has it, in place in its product's list.
export function putVariant(queryClient: QueryClient, saved: Variant): void {
  queryClient.setQueryData<Variant[]>(
    catalogKeys.variants(saved.productId),
    (list) =>
      list?.map((variant) => (variant.id === saved.id ? saved : variant)),
  );
}

// A deleted pack size, out of its product's list.
export function dropVariant(
  queryClient: QueryClient,
  productId: string,
  id: string,
): void {
  queryClient.setQueryData<Variant[]>(catalogKeys.variants(productId), (list) =>
    list?.filter((variant) => variant.id !== id),
  );
}

// A new image, after the last one in its product's list, as the API puts it.
export function addImage(queryClient: QueryClient, saved: ProductImage): void {
  queryClient.setQueryData<ProductImage[]>(
    catalogKeys.images(saved.productId),
    (list) => list && [...list.filter((image) => image.id !== saved.id), saved],
  );
}

// An image as the server now has it, in place in its product's list.
export function putImage(queryClient: QueryClient, saved: ProductImage): void {
  queryClient.setQueryData<ProductImage[]>(
    catalogKeys.images(saved.productId),
    (list) => list?.map((image) => (image.id === saved.id ? saved : image)),
  );
}

// A deleted image, out of its product's list.
export function dropImage(
  queryClient: QueryClient,
  productId: string,
  id: string,
): void {
  queryClient.setQueryData<ProductImage[]>(
    catalogKeys.images(productId),
    (list) => list?.filter((image) => image.id !== id),
  );
}
