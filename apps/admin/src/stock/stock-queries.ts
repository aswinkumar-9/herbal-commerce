import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  listBatches,
  listMovements,
  listProductStock,
  listStock,
} from './stock-api';
import type { Batch, BatchList, StockQuery } from './stock-api';

// Where the console keeps each stock answer. Any change to stock
// invalidates stockKeys.all: a batch's packs change its pack size's sums,
// and the Stock page's filters.
export const stockKeys = {
  all: ['stock'] as const,
  lineLists: () => ['stock', 'lines'] as const,
  lines: (query: Omit<StockQuery, 'after'>) =>
    ['stock', 'lines', query] as const,
  // A product's pack sizes with their stock, for its page.
  productLines: (productId: string) =>
    ['stock', 'lines', 'product', productId] as const,
  batches: (variantId: string) => ['stock', 'pack', variantId] as const,
  movements: (batchId: string) =>
    ['stock', 'batch', batchId, 'movements'] as const,
};

// The Stock page a page at a time: each page's nextAfter asks for the next.
// While another filter loads, the last list stays (isPlaceholderData says
// so).
export function useStockPages(query: Omit<StockQuery, 'after'>) {
  return useInfiniteQuery({
    queryKey: stockKeys.lines(query),
    queryFn: ({ pageParam, signal }) =>
      listStock({ ...query, after: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    placeholderData: keepPreviousData,
  });
}

// Every pack size of a product with its stock. Not asked while the product
// has no pack size (enabled false).
export function useProductStock(productId: string, enabled = true) {
  return useQuery({
    queryKey: stockKeys.productLines(productId),
    queryFn: ({ signal }) => listProductStock(productId, signal),
    enabled,
  });
}

// A pack size's batches, the first to expire first, with its stock.
export function useBatches(variantId: string) {
  return useQuery({
    queryKey: stockKeys.batches(variantId),
    queryFn: ({ signal }) => listBatches(variantId, signal),
  });
}

// A batch's movements, newest first, a page at a time.
export function useMovementPages(batchId: string) {
  return useInfiniteQuery({
    queryKey: stockKeys.movements(batchId),
    queryFn: ({ pageParam, signal }) =>
      listMovements(batchId, { before: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });
}

// The first to expire first, as the API lists them and orders take them.
function firstToExpire(a: Batch, b: Batch): number {
  if (a.expiresOn !== b.expiresOn) {
    return a.expiresOn < b.expiresOn ? -1 : 1;
  }
  return a.batchNumber < b.batchNumber
    ? -1
    : a.batchNumber > b.batchNumber
      ? 1
      : 0;
}

// A batch as the server now has it, received or changed: in place in its
// pack size's list at once, then every stock answer read again, as its
// pack size's sums changed too.
export function stockChanged(queryClient: QueryClient, saved: Batch): void {
  queryClient.setQueryData<BatchList>(
    stockKeys.batches(saved.variantId),
    (list) =>
      list && {
        ...list,
        batches: [
          ...list.batches.filter((batch) => batch.id !== saved.id),
          saved,
        ].sort(firstToExpire),
      },
  );
  void queryClient.invalidateQueries({ queryKey: stockKeys.all });
}
