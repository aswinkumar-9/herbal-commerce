import { z } from 'zod';
import { apiDownload, apiRequest } from '../api/client';
import { filterParams } from './sales-filters';
import type { SalesFilter } from './sales-filters';
import type { Period } from './sales-periods';

// A period's sales, for Super Users only (part 15D, ADR 0047), compared
// with the period of the same length just before. Read from the daily
// summaries, rebuilt every 5 minutes: refreshedAt says when they last were.

const SALES = '/v1/staff/reports/sales';
const SALES_EXPORT = '/v1/staff/reports/sales/export';
export const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const rupees = z.int();
const count = z.int().nonnegative();
const period = z.object({ from: z.iso.date(), to: z.iso.date() });

const totalsSchema = z.object({
  // What the products sold for, without the GST in their prices, less what
  // was refunded: below 0 when more went back than was sold.
  salesRupees: rupees,
  gstRupees: rupees,
  // None for some products only: delivery is charged on a whole order.
  deliveryRupees: rupees.nullable(),
  // What customers paid, less what went back.
  paidRupees: rupees,
  orders: count,
  // An order's products without GST, on average, before any refund. None
  // without orders.
  averageOrderRupees: rupees.nullable(),
  refundedOrders: count,
  refundedRupees: count,
  // Customers who paid for the first time ever in the period, and those
  // who had paid before it.
  newCustomers: count,
  returningCustomers: count,
});
export type SalesTotals = z.infer<typeof totalsSchema>;

export const PAYMENT_METHODS = [
  'UPI',
  'CARD',
  'NETBANKING',
  'WALLET',
  'EMI',
  'PAY_LATER',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const named = z.string().nullable();

const reportSchema = z.object({
  period,
  // What the report was narrowed to, named as the catalog names it now,
  // else as it last sold.
  filters: z.object({
    product: z.object({ productId: z.string(), name: named }).nullable(),
    category: z
      .object({ categoryId: z.string(), name: named, parentName: named })
      .nullable(),
    brand: z.object({ brandId: z.string(), name: named }).nullable(),
  }),
  previousPeriod: period,
  refreshedAt: z.iso.datetime().nullable(),
  totals: totalsSchema,
  previousTotals: totalsSchema,
  // Every day, week or month of the period, in order, those with nothing
  // too.
  series: z.object({
    unit: z.enum(['day', 'week', 'month']),
    points: z.array(
      z.object({ start: z.iso.date(), salesRupees: rupees, orders: count }),
    ),
  }),
  // The best 10. No ID: a product sold before part 15C whose pack size
  // was deleted.
  products: z.array(
    z.object({
      productId: z.string().nullable(),
      name: z.string(),
      salesRupees: rupees,
      packs: z.int(),
    }),
  ),
  // No ID: not recorded, for those same old lines.
  categories: z.array(
    z.object({
      categoryId: z.string().nullable(),
      name: z.string().nullable(),
      salesRupees: rupees,
      subcategories: z.array(
        z.object({
          categoryId: z.string(),
          name: z.string(),
          salesRupees: rupees,
        }),
      ),
    }),
  ),
  // The best 10. No ID: no brand, or not recorded (recorded false).
  brands: z.array(
    z.object({
      brandId: z.string().nullable(),
      name: z.string().nullable(),
      recorded: z.boolean(),
      salesRupees: rupees,
    }),
  ),
  states: z.array(
    z.object({ state: z.string(), salesRupees: rupees, orders: count }),
  ),
  // No method: not recorded, for payments made before part 15C.
  methods: z.array(
    z.object({
      method: z.enum(PAYMENT_METHODS).nullable(),
      salesRupees: rupees,
      orders: count,
    }),
  ),
});
export type SalesReport = z.infer<typeof reportSchema>;

export function getSalesReport(
  { from, to }: Period,
  filter: SalesFilter,
  signal?: AbortSignal,
): Promise<SalesReport> {
  const search = new URLSearchParams({ from, to, ...filterParams(filter) });
  return apiRequest(`${SALES}?${search.toString()}`, {
    schema: reportSchema,
    signal,
  });
}

// The same period and filter as an Excel file (part 15D): a summary, each
// day, each grouping and the register of every line sold or refunded. The
// API writes each download to the audit log.
export function downloadSalesReport(
  { from, to }: Period,
  filter: SalesFilter,
): Promise<{ file: Blob; fileName: string }> {
  const search = new URLSearchParams({ from, to, ...filterParams(filter) });
  return apiDownload(`${SALES_EXPORT}?${search.toString()}`, XLSX_TYPE);
}
