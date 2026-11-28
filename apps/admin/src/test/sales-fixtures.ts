import type { SalesReport, SalesTotals } from '../sales/sales-api';
import { periodBefore } from '../sales/sales-display';
import { json } from './fake-api';

// The Sales page's report as the API sends it.

// With a filter's parameters after the days, as "&productId=…".
export const SALES = (from: string, to: string, filter = '') =>
  `GET /v1/staff/reports/sales?from=${from}&to=${to}${filter}`;

// The page opens on the last 30 days: on 25 Nov 2026, from 27 Oct.
export const LAST_30 = SALES('2026-10-27', '2026-11-25');

export const NOTHING: SalesTotals = {
  salesRupees: 0,
  gstRupees: 0,
  deliveryRupees: 0,
  paidRupees: 0,
  orders: 0,
  averageOrderRupees: null,
  refundedOrders: 0,
  refundedRupees: 0,
  newCustomers: 0,
  returningCustomers: 0,
};

// The API specification's example: 4 orders, 1 of them refunded.
export const SOME: SalesTotals = {
  salesRupees: 1374,
  gstRupees: 179,
  deliveryRupees: 49,
  paidRupees: 1602,
  orders: 4,
  averageOrderRupees: 451,
  refundedOrders: 1,
  refundedRupees: 498,
  newCustomers: 2,
  returningCustomers: 1,
};

export function reportOf(
  from: string,
  to: string,
  changes: Partial<SalesReport> = {},
): SalesReport {
  return {
    period: { from, to },
    filters: {
      product: null,
      category: null,
      brand: null,
      state: null,
      method: null,
    },
    previousPeriod: periodBefore({ from, to }),
    refreshedAt: '2026-11-25T06:40:00.000Z',
    totals: SOME,
    previousTotals: NOTHING,
    series: { unit: 'day', points: [] },
    calendar: null,
    products: [],
    categories: [],
    brands: [],
    states: [],
    methods: [],
    ...changes,
  };
}

export const salesOf =
  (from: string, to: string, changes: Partial<SalesReport> = {}) =>
  () =>
    json(200, reportOf(from, to, changes));
