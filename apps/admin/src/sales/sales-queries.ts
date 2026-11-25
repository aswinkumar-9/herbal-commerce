import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  listBrands,
  listCategories,
  listProducts,
} from '../catalog/catalog-api';
import { catalogKeys } from '../catalog/catalog-queries';
import { getSalesReport } from './sales-api';
import { MATCHES_SHOWN } from './sales-filters';
import type { SalesFilter } from './sales-filters';
import type { Period } from './sales-periods';

// The summaries behind the report are rebuilt every 5 minutes, so the page
// asks again as often while it is open.
export const SALES_REFRESH_MS = 5 * 60_000;

export const salesKeys = {
  all: ['sales'] as const,
  report: ({ from, to }: Period, filter: SalesFilter) =>
    ['sales', from, to, filter] as const,
  products: (words: string) => ['sales', 'products', words] as const,
};

// A period's sales, narrowed or not. While another loads, the last one
// stays on the page, dimmed.
export function useSalesReport(period: Period, filter: SalesFilter) {
  return useQuery({
    queryKey: salesKeys.report(period, filter),
    queryFn: ({ signal }) => getSalesReport(period, filter, signal),
    placeholderData: keepPreviousData,
    refetchInterval: SALES_REFRESH_MS,
  });
}

// Every category and brand, as the catalog pages keep them, asked for only
// once a search starts.
export function useCatalogNames(searching: boolean) {
  const categories = useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => listCategories(signal),
    enabled: searching,
  });
  const brands = useQuery({
    queryKey: catalogKeys.brands(),
    queryFn: ({ signal }) => listBrands(signal),
    enabled: searching,
  });
  return { categories, brands };
}

// The products whose names best match the words, drafts too: their sales
// count as any other's.
export function useProductMatches(words: string | undefined) {
  return useQuery({
    queryKey: salesKeys.products(words ?? ''),
    queryFn: ({ signal }) =>
      listProducts({ q: words, limit: MATCHES_SHOWN }, signal),
    enabled: words !== undefined,
    placeholderData: keepPreviousData,
  });
}
