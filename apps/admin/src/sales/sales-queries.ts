import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getSalesReport } from './sales-api';
import type { Period } from './sales-periods';

// The summaries behind the report are rebuilt every 5 minutes, so the page
// asks again as often while it is open.
export const SALES_REFRESH_MS = 5 * 60_000;

export const salesKeys = {
  all: ['sales'] as const,
  report: ({ from, to }: Period) => ['sales', from, to] as const,
};

// A period's sales. While another period loads, the last one stays on the
// page, dimmed.
export function useSalesReport(period: Period) {
  return useQuery({
    queryKey: salesKeys.report(period),
    queryFn: ({ signal }) => getSalesReport(period, signal),
    placeholderData: keepPreviousData,
    refetchInterval: SALES_REFRESH_MS,
  });
}
