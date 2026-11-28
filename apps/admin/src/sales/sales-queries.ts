import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  listBrands,
  listCategories,
  listProducts,
} from '../catalog/catalog-api';
import { catalogKeys } from '../catalog/catalog-queries';
import {
  getCustomersReport,
  getOrdersReport,
  getSalesReport,
} from './sales-api';
import { MATCHES_SHOWN } from './sales-filters';
import type { SalesFilter } from './sales-filters';
import type { Period, Unit } from './sales-periods';

// The summaries behind the report are rebuilt every 5 minutes, so the page
// asks again as often while it is open.
export const SALES_REFRESH_MS = 5 * 60_000;
// The orders are read live, so their tab looks again every minute, as the
// orders list does.
export const ORDERS_REFRESH_MS = 60_000;

export const salesKeys = {
  all: ['sales'] as const,
  report: ({ from, to }: Period, filter: SalesFilter, unit?: Unit) =>
    ['sales', from, to, filter, unit ?? 'chosen'] as const,
  products: (words: string) => ['sales', 'products', words] as const,
  customers: ({ from, to }: Period, filter: SalesFilter, unit?: Unit) =>
    ['sales', 'customers', from, to, filter, unit ?? 'chosen'] as const,
  orders: ({ from, to }: Period, filter: SalesFilter, unit?: Unit) =>
    ['sales', 'orders', from, to, filter, unit ?? 'chosen'] as const,
};

// A period's sales, narrowed or not, its chart in the bars asked for. While
// another loads, the last one stays on the page, dimmed.
export function useSalesReport(
  period: Period,
  filter: SalesFilter,
  unit?: Unit,
) {
  return useQuery({
    queryKey: salesKeys.report(period, filter, unit),
    queryFn: ({ signal }) => getSalesReport(period, filter, unit, signal),
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

// A period's customers, asked for only on their tab.
export function useCustomersReport(
  period: Period,
  filter: SalesFilter,
  unit: Unit | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: salesKeys.customers(period, filter, unit),
    queryFn: ({ signal }) => getCustomersReport(period, filter, unit, signal),
    placeholderData: keepPreviousData,
    refetchInterval: SALES_REFRESH_MS,
    enabled,
  });
}

// A period's orders, asked for only on their tab.
export function useOrdersReport(
  period: Period,
  filter: SalesFilter,
  unit: Unit | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: salesKeys.orders(period, filter, unit),
    queryFn: ({ signal }) => getOrdersReport(period, filter, unit, signal),
    placeholderData: keepPreviousData,
    refetchInterval: ORDERS_REFRESH_MS,
    enabled,
  });
}
