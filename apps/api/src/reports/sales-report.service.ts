import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { PaymentMethod } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { NOT_RECORDED, type SalesReportQuery } from './reports.schemas';
import { detailOf, type PlaceSums, type SalesDetail } from './sales-detail';
import {
  addDays,
  barOf,
  barsOf,
  dateOf,
  dayOf,
  daysIn,
  MAX_BARS,
  previousPeriod,
  type SeriesUnit,
  unitFor,
} from './sales-periods';

// How many products and brands the report lists, the best first.
export const TOP_LIMIT = 10;

const ORDER_SUMS = {
  soldOrders: true,
  soldItemsRupees: true,
  soldGstRupees: true,
  soldDeliveryRupees: true,
  refundedOrders: true,
  refundedItemsRupees: true,
  refundedGstRupees: true,
  refundedDeliveryRupees: true,
} as const;
type OrderSums = Partial<Record<keyof typeof ORDER_SUMS, number | null>>;

const LINE_SUMS = {
  soldPacks: true,
  soldRupees: true,
  soldGstRupees: true,
  refundedPacks: true,
  refundedRupees: true,
  refundedGstRupees: true,
} as const;
type LineSums = Partial<Record<keyof typeof LINE_SUMS, number | null>>;

export interface Period {
  from: string;
  to: string;
}

export interface SalesTotals {
  // The headline (the owner's choice, 2026-11-25): what the products sold
  // for, without the GST inside their prices, less what was refunded.
  salesRupees: number;
  gstRupees: number;
  // None for some products only: delivery is charged on a whole order.
  deliveryRupees: number | null;
  // What customers paid, less what went back: the three above together.
  paidRupees: number;
  // The orders paid in the period.
  orders: number;
  // What an order paid in the period came to on average, its products
  // without GST, before any refund. None without orders.
  averageOrderRupees: number | null;
  // The orders refunded in the period, and everything that went back.
  refundedOrders: number;
  refundedRupees: number;
  // The customers who paid in the period: for the first time ever, or
  // having paid before.
  newCustomers: number;
  returningCustomers: number;
}

// What the report is narrowed to, if anything: a product, a category (a
// top one with its subcategories, or a subcategory), a brand, the state the
// orders went to, or how they were paid (part 15E), or those together. The
// catalog's each named as the catalog names it now, else as it last sold.
export interface SalesFilter {
  productId?: string | undefined;
  categoryId?: string | undefined;
  brandId?: string | undefined;
  state?: string | undefined;
  method?: PaymentMethod | typeof NOT_RECORDED | undefined;
}
export interface SalesFilters {
  product: { productId: string; name: string | null } | null;
  category: {
    categoryId: string;
    name: string | null;
    parentName: string | null;
  } | null;
  brand: { brandId: string; name: string | null } | null;
  state: { state: string } | null;
  // No method: the payments that kept none.
  method: { method: PaymentMethod | null } | null;
}

export interface SalesReport {
  period: Period;
  filters: SalesFilters;
  previousPeriod: Period;
  // When the summaries were last rebuilt; none before the first time.
  refreshedAt: Date | null;
  totals: SalesTotals;
  previousTotals: SalesTotals;
  // Each day's, week's, month's, quarter's or financial year's sales and
  // orders, every one of them, beside those of the same days of the period
  // before: as many days earlier as the period is long.
  series: {
    unit: SeriesUnit;
    points: {
      start: string;
      salesRupees: number;
      orders: number;
      previous: { salesRupees: number; orders: number };
    }[];
  };
  // Each day's sales and orders, for a calendar: every day of a period of
  // at most MAX_BARS days, none for a longer one.
  calendar: { day: string; salesRupees: number; orders: number }[] | null;
  // A product without an ID is one sold before part 15C whose pack size
  // was deleted: it is known by its name only.
  products: {
    productId: string | null;
    name: string;
    salesRupees: number;
    packs: number;
  }[];
  // No ID: not recorded, for those same old lines.
  categories: {
    categoryId: string | null;
    name: string | null;
    salesRupees: number;
    subcategories: { categoryId: string; name: string; salesRupees: number }[];
  }[];
  // No ID: no brand, or not recorded for those old lines.
  brands: {
    brandId: string | null;
    name: string | null;
    recorded: boolean;
    salesRupees: number;
  }[];
  states: { state: string; salesRupees: number; orders: number }[];
  // No method: not recorded, for payments made before part 15C.
  methods: {
    method: PaymentMethod | null;
    salesRupees: number;
    orders: number;
  }[];
}

const zero = (value: number | null | undefined) => value ?? 0;

interface Bounds {
  from: string;
  to: string;
  previousFrom: string;
}
type Customers = Record<
  'current' | 'previous',
  { new: number; returning: number } | undefined
>;
// The totals, and each day's and each place's sales and orders.
interface Figures {
  totals: SalesTotals;
  previousTotals: SalesTotals;
  days: SalesDay[];
  previousDays: SalesDay[];
  places: {
    state: string;
    method: PaymentMethod | null;
    salesRupees: number;
    orders: number;
  }[];
}
// A day's figures, as the totals count them.
export type SalesDay = { day: string } & Pick<
  SalesTotals,
  | 'salesRupees'
  | 'gstRupees'
  | 'deliveryRupees'
  | 'paidRupees'
  | 'orders'
  | 'refundedOrders'
  | 'refundedRupees'
>;
const dayOfTotals = (day: string, totals: SalesTotals): SalesDay => ({
  day,
  salesRupees: totals.salesRupees,
  gstRupees: totals.gstRupees,
  deliveryRupees: totals.deliveryRupees,
  paidRupees: totals.paidRupees,
  orders: totals.orders,
  refundedOrders: totals.refundedOrders,
  refundedRupees: totals.refundedRupees,
});

// A line of the sales register: a product sold, or refunded (below 0), or
// an order's delivery charge (no product), at a time in India.
export interface RegisterLine {
  at: string;
  kind: 'SALE' | 'REFUND';
  reference: string;
  state: string;
  method: PaymentMethod | null;
  // None for a delivery charge.
  product: {
    name: string;
    sku: string;
    categoryName: string | null;
    subcategoryName: string | null;
    brandName: string | null;
    gstRate: number;
  } | null;
  packs: number;
  // Without GST, its GST, and the two together.
  priceRupees: number;
  gstRupees: number;
  totalRupees: number;
}

// At most this many lines in one register: a longer period goes in parts.
export const MAX_REGISTER_LINES = 100_000;
// The register as the database gives it: one row for each line of an order
// paid or refunded.
interface RegisterRow {
  at: string;
  sortAt: Date;
  refunded: boolean;
  reference: string;
  state: string;
  method: PaymentMethod | null;
  deliveryRupees: number;
  position: number;
  productName: string;
  sku: string;
  topCategoryName: string | null;
  subcategoryName: string | null;
  brandName: string | null;
  gstRate: number;
  packs: number;
  lineTotalRupees: number;
  gstRupees: number;
}

// Every day from one to another, both included.
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

// Orders paid, or refunded, on a day, by place.
interface OrderCount {
  day: string;
  state: string;
  method: PaymentMethod | null;
  refunded: boolean;
  orders: number;
}
// A product as it sold in the period, with its groupings.
interface SoldLine {
  productId: string | null;
  productName: string;
  topCategoryId: string | null;
  topCategoryName: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  _max: { day: Date | null };
}

// The products without GST, less what was refunded.
const orderSales = (sums: OrderSums) =>
  zero(sums.soldItemsRupees) -
  zero(sums.soldGstRupees) -
  (zero(sums.refundedItemsRupees) - zero(sums.refundedGstRupees));
const lineSales = (sums: LineSums) =>
  zero(sums.soldRupees) -
  zero(sums.soldGstRupees) -
  (zero(sums.refundedRupees) - zero(sums.refundedGstRupees));

function totalsOf(
  sums: OrderSums,
  customers: { new: number; returning: number } | undefined,
): SalesTotals {
  const salesRupees = orderSales(sums);
  const gstRupees = zero(sums.soldGstRupees) - zero(sums.refundedGstRupees);
  const deliveryRupees =
    zero(sums.soldDeliveryRupees) - zero(sums.refundedDeliveryRupees);
  const orders = zero(sums.soldOrders);
  const soldProducts = zero(sums.soldItemsRupees) - zero(sums.soldGstRupees);
  return {
    salesRupees,
    gstRupees,
    deliveryRupees,
    paidRupees: salesRupees + gstRupees + deliveryRupees,
    orders,
    averageOrderRupees: orders > 0 ? Math.round(soldProducts / orders) : null,
    refundedOrders: zero(sums.refundedOrders),
    refundedRupees:
      zero(sums.refundedItemsRupees) + zero(sums.refundedDeliveryRupees),
    newCustomers: customers?.new ?? 0,
    returningCustomers: customers?.returning ?? 0,
  };
}

// The same for some products only, from their lines: the GST in their
// prices, no delivery (charged on a whole order), and what was refunded of
// them. The orders are those with one of them in.
function lineTotalsOf(
  sums: LineSums,
  counts: { orders: number; refundedOrders: number },
  customers: { new: number; returning: number } | undefined,
): SalesTotals {
  const salesRupees = lineSales(sums);
  const gstRupees = zero(sums.soldGstRupees) - zero(sums.refundedGstRupees);
  const soldProducts = zero(sums.soldRupees) - zero(sums.soldGstRupees);
  return {
    salesRupees,
    gstRupees,
    deliveryRupees: null,
    paidRupees: salesRupees + gstRupees,
    orders: counts.orders,
    averageOrderRupees:
      counts.orders > 0 ? Math.round(soldProducts / counts.orders) : null,
    refundedOrders: counts.refundedOrders,
    refundedRupees: zero(sums.refundedRupees),
    newCustomers: customers?.new ?? 0,
    returningCustomers: customers?.returning ?? 0,
  };
}

// The filter, when there is one.
export function filterOf({
  productId,
  categoryId,
  brandId,
  state,
  method,
}: SalesFilter): SalesFilter | null {
  return productId || categoryId || brandId || state || method
    ? { productId, categoryId, brandId, state, method }
    : null;
}

// Whether a filter keeps some products only. Then the delivery charge,
// which belongs to a whole order, is not split, and the orders are counted
// from their lines.
export const keepsProducts = (filter: SalesFilter | null): boolean =>
  Boolean(filter?.productId ?? filter?.categoryId ?? filter?.brandId);

// The summary rows of the orders a filter keeps by the state they went to
// and how they were paid: both summaries keep these.
function placeOf(filter: SalesFilter | null): {
  deliveryState?: string;
  method?: PaymentMethod | null;
} {
  return {
    ...(filter?.state ? { deliveryState: filter.state } : {}),
    ...(filter?.method
      ? { method: filter.method === NOT_RECORDED ? null : filter.method }
      : {}),
  };
}

// The same for a query of the orders and payments themselves: whether to
// keep one state, and one way of paying, none recorded included.
function placeParams(filter: SalesFilter | null) {
  return {
    state: filter?.state ?? null,
    methodKept: Boolean(filter?.method),
    method:
      filter?.method && filter.method !== NOT_RECORDED ? filter.method : null,
  };
}

// The summary rows of the products a filter keeps, a category its
// subcategories' too, of the orders it keeps by place.
function linesOf(filter: SalesFilter | null): Prisma.DailyLineSaleWhereInput {
  return {
    ...placeOf(filter),
    ...(filter?.productId ? { productId: filter.productId } : {}),
    ...(filter?.brandId ? { brandId: filter.brandId } : {}),
    ...(filter?.categoryId
      ? {
          OR: [
            { topCategoryId: filter.categoryId },
            { subcategoryId: filter.categoryId },
          ],
        }
      : {}),
  };
}

// UTC, as the database keeps its times, as text for a query: so the
// connection's time zone never moves it.
export const utcText = (at: Date) =>
  at.toISOString().slice(0, 23).replace('T', ' ');

// An entry of a list, named after its latest row: a product renamed shows
// its newest name.
interface Named<N> {
  name: N;
  latest: number;
  salesRupees: number;
}
function entry<N, T extends Named<N>>(
  entries: Map<string, T>,
  key: string,
  fresh: () => T,
  name: N,
  latest: number,
): T {
  let found = entries.get(key);
  if (!found) {
    found = fresh();
    entries.set(key, found);
  }
  if (latest >= found.latest) {
    found.name = name;
    found.latest = latest;
  }
  return found;
}

// The best first; equal ones by name, those without one last.
function ranked<T extends { salesRupees: number }>(
  list: Iterable<T>,
  nameOf: (item: T) => string | null,
): T[] {
  const byName = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b);
  return [...list].sort(
    (a, b) => b.salesRupees - a.salesRupees || byName(nameOf(a), nameOf(b)),
  );
}
const byName = (item: { name: string | null }) => item.name;

@Injectable()
export class SalesReportService {
  constructor(private readonly prisma: PrismaService) {}

  // The sales report of a period for Super Users (ADR 0047), read from the
  // daily summaries (ADR 0046), and the customers from the payments. In one
  // snapshot, so the totals, the chart and the lists always agree, even
  // while the summaries are being rebuilt.
  sales(query: SalesReportQuery): Promise<SalesReport> {
    return this.prisma.$transaction(
      async (tx) => (await this.read(tx, query, TOP_LIMIT)).report,
      { isolationLevel: 'RepeatableRead' },
    );
  }

  // The same for a download (ADR 0047): every product and brand, every
  // day's figures, each grouping in full beside the period before, and the
  // register of each line sold or refunded, with each order's delivery
  // charge when nothing is filtered. All in one snapshot, and the register
  // only up to when the summaries were last rebuilt, so it adds up to the
  // totals. Null when the register would be longer than MAX_REGISTER_LINES.
  forExport(query: SalesReportQuery): Promise<{
    report: SalesReport;
    days: SalesDay[];
    detail: SalesDetail;
    register: RegisterLine[];
  } | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const { report, days } = await this.read(tx, query, null);
        const register = await this.register(tx, query, report.refreshedAt);
        if (register === null) {
          return null;
        }
        const detail = await this.detail(tx, query, report);
        const byDay = new Map(days.map((day) => [day.day, day]));
        const every = daysBetween(query.from, query.to).map(
          (day) =>
            byDay.get(day) ??
            dayOfTotals(
              day,
              keepsProducts(filterOf(query))
                ? lineTotalsOf({}, { orders: 0, refundedOrders: 0 }, undefined)
                : totalsOf({}, undefined),
            ),
        );
        return { report, days: every, detail, register };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  // Each grouping's lines, and each state's and method's, in the period and
  // the one before: of every order, or of the filter's products only.
  private async detail(
    tx: Prisma.TransactionClient,
    { from, to, ...asked }: SalesReportQuery,
    report: SalesReport,
  ): Promise<SalesDetail> {
    const filter = filterOf(asked);
    const within = (period: Period) => ({
      day: { gte: dateOf(period.from), lte: dateOf(period.to) },
    });
    const linesIn = (period: Period) =>
      tx.dailyLineSale.groupBy({
        by: [
          'productId',
          'productName',
          'topCategoryId',
          'topCategoryName',
          'subcategoryId',
          'subcategoryName',
          'brandId',
          'brandName',
        ],
        where: { ...within(period), ...linesOf(filter) },
        _sum: LINE_SUMS,
        _max: { day: true },
      });
    const placesIn = async (period: Period): Promise<PlaceSums[]> =>
      keepsProducts(filter)
        ? (
            await tx.dailyLineSale.groupBy({
              by: ['deliveryState', 'method'],
              where: { ...within(period), ...linesOf(filter) },
              _sum: LINE_SUMS,
            })
          ).map((row) => ({
            state: row.deliveryState,
            method: row.method,
            grossRupees:
              zero(row._sum.soldRupees) - zero(row._sum.soldGstRupees),
            refundRupees:
              zero(row._sum.refundedRupees) - zero(row._sum.refundedGstRupees),
            gstRupees:
              zero(row._sum.soldGstRupees) - zero(row._sum.refundedGstRupees),
            deliveryRupees: null,
          }))
        : (
            await tx.dailyOrderSale.groupBy({
              by: ['deliveryState', 'method'],
              where: { ...within(period), ...placeOf(filter) },
              _sum: ORDER_SUMS,
            })
          ).map((row) => ({
            state: row.deliveryState,
            method: row.method,
            grossRupees:
              zero(row._sum.soldItemsRupees) - zero(row._sum.soldGstRupees),
            refundRupees:
              zero(row._sum.refundedItemsRupees) -
              zero(row._sum.refundedGstRupees),
            gstRupees:
              zero(row._sum.soldGstRupees) - zero(row._sum.refundedGstRupees),
            deliveryRupees:
              zero(row._sum.soldDeliveryRupees) -
              zero(row._sum.refundedDeliveryRupees),
          }));
    const period = { from, to };
    return detailOf({
      lines: await linesIn(period),
      previousLines: await linesIn(report.previousPeriod),
      places: await placesIn(period),
      previousPlaces: await placesIn(report.previousPeriod),
      states: report.states,
      methods: report.methods,
      narrowed: keepsProducts(filter),
    });
  }

  private async read(
    tx: Prisma.TransactionClient,
    { from, to, ...asked }: SalesReportQuery,
    // How many products and brands to list, or all of them.
    limit: number | null,
  ): Promise<{ report: SalesReport; days: SalesDay[] }> {
    const previous = previousPeriod(from, to);
    const unit = asked.unit ?? unitFor(from, to);
    const length = daysIn(from, to);
    const bounds = { from, to, previousFrom: previous.from };
    const inPeriod = { day: { gte: dateOf(from), lte: dateOf(to) } };
    const filter = filterOf(asked);

    const refresh = await tx.salesSummaryRefresh.findUnique({
      where: { id: 1 },
      select: { refreshedAt: true },
    });
    const refreshedAt = refresh?.refreshedAt ?? null;
    const customers = await this.customers(tx, bounds, filter, refreshedAt);
    const figures =
      filter && keepsProducts(filter)
        ? await this.filteredFigures(tx, bounds, filter, refreshedAt, customers)
        : await this.allFigures(tx, bounds, filter, customers);
    const lines = await tx.dailyLineSale.groupBy({
      by: [
        'productId',
        'productName',
        'topCategoryId',
        'topCategoryName',
        'subcategoryId',
        'subcategoryName',
        'brandId',
        'brandName',
      ],
      where: { ...inPeriod, ...linesOf(filter) },
      _sum: LINE_SUMS,
      _max: { day: true },
    });

    const points = new Map(
      barsOf(from, to, unit).map((start) => [
        start,
        {
          start,
          salesRupees: 0,
          orders: 0,
          previous: { salesRupees: 0, orders: 0 },
        },
      ]),
    );
    for (const row of figures.days) {
      const point = points.get(barOf(row.day, unit, from));
      if (point) {
        point.salesRupees += row.salesRupees;
        point.orders += row.orders;
      }
    }
    // A day of the period before goes beside the day as many days later as
    // the period is long.
    for (const row of figures.previousDays) {
      const point = points.get(barOf(addDays(row.day, length), unit, from));
      if (point) {
        point.previous.salesRupees += row.salesRupees;
        point.previous.orders += row.orders;
      }
    }
    const byDay = new Map(figures.days.map((row) => [row.day, row]));
    const calendar =
      length <= MAX_BARS
        ? daysBetween(from, to).map((day) => ({
            day,
            salesRupees: byDay.get(day)?.salesRupees ?? 0,
            orders: byDay.get(day)?.orders ?? 0,
          }))
        : null;

    const states = new Map<string, SalesReport['states'][number]>();
    const methods = new Map<string, SalesReport['methods'][number]>();
    for (const row of figures.places) {
      const state = states.get(row.state) ?? {
        state: row.state,
        salesRupees: 0,
        orders: 0,
      };
      const method = methods.get(row.method ?? '') ?? {
        method: row.method,
        salesRupees: 0,
        orders: 0,
      };
      for (const found of [state, method]) {
        found.salesRupees += row.salesRupees;
        found.orders += row.orders;
      }
      states.set(row.state, state);
      methods.set(row.method ?? '', method);
    }

    type Product = SalesReport['products'][number] & Named<string>;
    type Subcategory =
      SalesReport['categories'][number]['subcategories'][number] &
        Named<string>;
    type Category = Omit<SalesReport['categories'][number], 'subcategories'> &
      Named<string | null> & { subcategories: Map<string, Subcategory> };
    type Brand = SalesReport['brands'][number] & Named<string | null>;
    const products = new Map<string, Product>();
    const categories = new Map<string, Category>();
    const brands = new Map<string, Brand>();
    for (const row of lines) {
      const sales = lineSales(row._sum);
      const latest = row._max.day?.getTime() ?? 0;
      const product = entry(
        products,
        row.productId ?? `name:${row.productName}`,
        () => ({
          productId: row.productId,
          name: row.productName,
          latest: -1,
          salesRupees: 0,
          packs: 0,
        }),
        row.productName,
        latest,
      );
      product.salesRupees += sales;
      product.packs += zero(row._sum.soldPacks) - zero(row._sum.refundedPacks);

      const top = entry(
        categories,
        row.topCategoryId ?? 'not recorded',
        () => ({
          categoryId: row.topCategoryId,
          name: null,
          latest: -1,
          salesRupees: 0,
          subcategories: new Map<string, Subcategory>(),
        }),
        row.topCategoryName,
        latest,
      );
      top.salesRupees += sales;
      if (row.subcategoryId !== null && row.subcategoryName !== null) {
        const subcategoryId = row.subcategoryId;
        entry(
          top.subcategories,
          subcategoryId,
          () => ({
            categoryId: subcategoryId,
            name: '',
            latest: -1,
            salesRupees: 0,
          }),
          row.subcategoryName,
          latest,
        ).salesRupees += sales;
      }

      // Every line since part 15C has its top category: one without is an
      // old line with nothing recorded, not a product without a brand.
      const recorded = row.topCategoryId !== null;
      entry(
        brands,
        row.brandId ?? (recorded ? 'no brand' : 'not recorded'),
        () => ({
          brandId: row.brandId,
          name: null,
          recorded,
          latest: -1,
          salesRupees: 0,
        }),
        row.brandName,
        latest,
      ).salesRupees += sales;
    }

    const top = <T>(list: T[]) =>
      limit === null ? list : list.slice(0, limit);
    const report: SalesReport = {
      period: { from, to },
      filters: await this.filtersOf(tx, filter, lines),
      previousPeriod: previous,
      refreshedAt,
      totals: figures.totals,
      previousTotals: figures.previousTotals,
      series: { unit, points: [...points.values()] },
      calendar,
      products: top(ranked(products.values(), byName)).map(
        ({ productId, name, salesRupees, packs }) => ({
          productId,
          name,
          salesRupees,
          packs,
        }),
      ),
      categories: ranked(categories.values(), byName).map(
        ({ categoryId, name, salesRupees, subcategories }) => ({
          categoryId,
          name,
          salesRupees,
          subcategories: ranked(subcategories.values(), byName).map(
            (subcategory) => ({
              categoryId: subcategory.categoryId,
              name: subcategory.name,
              salesRupees: subcategory.salesRupees,
            }),
          ),
        }),
      ),
      brands: top(ranked(brands.values(), byName)).map(
        ({ brandId, name, recorded, salesRupees }) => ({
          brandId,
          name,
          recorded,
          salesRupees,
        }),
      ),
      states: ranked(states.values(), (state) => state.state),
      methods: ranked(methods.values(), (method) => method.method),
    };
    return { report, days: figures.days };
  }

  // The totals, and each day's and each place's sales and orders, of every
  // sale, or of those a filter keeps by place: from the summaries of whole
  // orders.
  private async allFigures(
    tx: Prisma.TransactionClient,
    { from, to }: Bounds,
    filter: SalesFilter | null,
    customers: Customers,
  ): Promise<Figures> {
    const previous = previousPeriod(from, to);
    const place = placeOf(filter);
    const inPeriod = { day: { gte: dateOf(from), lte: dateOf(to) }, ...place };
    const inPrevious = {
      day: { gte: dateOf(previous.from), lte: dateOf(previous.to) },
      ...place,
    };
    const now = await tx.dailyOrderSale.aggregate({
      where: inPeriod,
      _sum: ORDER_SUMS,
    });
    const before = await tx.dailyOrderSale.aggregate({
      where: inPrevious,
      _sum: ORDER_SUMS,
    });
    const days = await tx.dailyOrderSale.groupBy({
      by: ['day'],
      where: inPeriod,
      _sum: ORDER_SUMS,
    });
    const previousDays = await tx.dailyOrderSale.groupBy({
      by: ['day'],
      where: inPrevious,
      _sum: ORDER_SUMS,
    });
    const places = await tx.dailyOrderSale.groupBy({
      by: ['deliveryState', 'method'],
      where: inPeriod,
      _sum: ORDER_SUMS,
    });
    return {
      totals: totalsOf(now._sum, customers.current),
      previousTotals: totalsOf(before._sum, customers.previous),
      days: days.map((row) =>
        dayOfTotals(dayOf(row.day), totalsOf(row._sum, undefined)),
      ),
      previousDays: previousDays.map((row) =>
        dayOfTotals(dayOf(row.day), totalsOf(row._sum, undefined)),
      ),
      places: places.map((row) => ({
        state: row.deliveryState,
        method: row.method,
        salesRupees: orderSales(row._sum),
        orders: zero(row._sum.soldOrders),
      })),
    };
  }

  // The same for some products only: their sales from the summaries of
  // lines, and the orders with one of them in from the payments and
  // refunds, as the summaries keep no orders of a product. Only those the
  // summaries had when last rebuilt, so the two always agree.
  private async filteredFigures(
    tx: Prisma.TransactionClient,
    { from, to, previousFrom }: Bounds,
    filter: SalesFilter,
    refreshedAt: Date | null,
    customers: Customers,
  ): Promise<Figures> {
    const matching = linesOf(filter);
    const previous = previousPeriod(from, to);
    const inPeriod = {
      day: { gte: dateOf(from), lte: dateOf(to) },
      ...matching,
    };
    const inPrevious = {
      day: { gte: dateOf(previous.from), lte: dateOf(previous.to) },
      ...matching,
    };
    const now = await tx.dailyLineSale.aggregate({
      where: inPeriod,
      _sum: LINE_SUMS,
    });
    const before = await tx.dailyLineSale.aggregate({
      where: inPrevious,
      _sum: LINE_SUMS,
    });
    const days = await tx.dailyLineSale.groupBy({
      by: ['day'],
      where: inPeriod,
      _sum: LINE_SUMS,
    });
    const previousDays = await tx.dailyLineSale.groupBy({
      by: ['day'],
      where: inPrevious,
      _sum: LINE_SUMS,
    });
    const places = await tx.dailyLineSale.groupBy({
      by: ['deliveryState', 'method'],
      where: inPeriod,
      _sum: LINE_SUMS,
    });
    const productId = filter.productId ?? null;
    const categoryId = filter.categoryId ?? null;
    const brandId = filter.brandId ?? null;
    const place = placeParams(filter);
    const counts = refreshedAt
      ? await tx.$queryRaw<OrderCount[]>`
          WITH "events" AS (
            SELECT p."orderId", p."method",
                   (p."paidAt" + INTERVAL '330 minutes')::date AS "day",
                   false AS "refunded"
              FROM "payments" p
             WHERE p."paidAt" >= ${previousFrom}::date - INTERVAL '330 minutes'
               AND p."paidAt" < (${to}::date + 1) - INTERVAL '330 minutes'
               AND p."paidAt" < ${utcText(refreshedAt)}::timestamp
            UNION ALL
            SELECT p."orderId", p."method",
                   (r."createdAt" + INTERVAL '330 minutes')::date,
                   true
              FROM "refunds" r
              JOIN "payments" p
                ON p."razorpayPaymentId" = r."razorpayPaymentId"
             WHERE r."createdAt" >= ${previousFrom}::date - INTERVAL '330 minutes'
               AND r."createdAt" < (${to}::date + 1) - INTERVAL '330 minutes'
               AND r."createdAt" < ${utcText(refreshedAt)}::timestamp
          )
          SELECT to_char(e."day", 'YYYY-MM-DD') AS "day",
                 o."deliveryState" AS "state", e."method"::text AS "method",
                 e."refunded", count(*)::int AS "orders"
            FROM "events" e
            JOIN "orders" o ON o."id" = e."orderId"
           WHERE EXISTS (
                   SELECT 1 FROM "order_items" i
                    WHERE i."orderId" = e."orderId"
                      AND (${productId}::uuid IS NULL
                           OR i."productId" = ${productId}::uuid)
                      AND (${categoryId}::uuid IS NULL
                           OR i."topCategoryId" = ${categoryId}::uuid
                           OR i."subcategoryId" = ${categoryId}::uuid)
                      AND (${brandId}::uuid IS NULL
                           OR i."brandId" = ${brandId}::uuid))
             AND (${place.state}::text IS NULL
                  OR o."deliveryState" = ${place.state}::text)
             AND (NOT ${place.methodKept}
                  OR e."method"::text IS NOT DISTINCT FROM ${place.method}::text)
           GROUP BY 1, 2, 3, 4`
      : [];

    const current = (row: OrderCount) => row.day >= from;
    const ordersIn = (rows: OrderCount[]) =>
      rows.reduce((sum, row) => sum + row.orders, 0);
    const countsOf = (inPeriodNow: boolean) => ({
      orders: ordersIn(
        counts.filter((row) => !row.refunded && current(row) === inPeriodNow),
      ),
      refundedOrders: ordersIn(
        counts.filter((row) => row.refunded && current(row) === inPeriodNow),
      ),
    });
    const sold = counts.filter((row) => !row.refunded && current(row));

    // Each day's lines, and its orders paid and refunded.
    const daysOf = (
      rows: { day: Date; _sum: LineSums }[],
      counted: OrderCount[],
    ): SalesDay[] => {
      const sumsByDay = new Map(rows.map((row) => [dayOf(row.day), row._sum]));
      const soldByDay = new Map<string, number>();
      const refundedByDay = new Map<string, number>();
      for (const row of counted) {
        const byDay = row.refunded ? refundedByDay : soldByDay;
        byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.orders);
      }
      const everyDay = new Set([
        ...sumsByDay.keys(),
        ...soldByDay.keys(),
        ...refundedByDay.keys(),
      ]);
      return [...everyDay].map((day) =>
        dayOfTotals(
          day,
          lineTotalsOf(
            sumsByDay.get(day) ?? {},
            {
              orders: soldByDay.get(day) ?? 0,
              refundedOrders: refundedByDay.get(day) ?? 0,
            },
            undefined,
          ),
        ),
      );
    };
    const placeFigures = new Map<string, Figures['places'][number]>();
    const placeFigure = (state: string, method: PaymentMethod | null) => {
      const key = `${state}\u0000${method ?? ''}`;
      const found = placeFigures.get(key) ?? {
        state,
        method,
        salesRupees: 0,
        orders: 0,
      };
      placeFigures.set(key, found);
      return found;
    };
    for (const row of places) {
      placeFigure(row.deliveryState, row.method).salesRupees += lineSales(
        row._sum,
      );
    }
    for (const row of sold) {
      placeFigure(row.state, row.method).orders += row.orders;
    }

    return {
      totals: lineTotalsOf(now._sum, countsOf(true), customers.current),
      previousTotals: lineTotalsOf(
        before._sum,
        countsOf(false),
        customers.previous,
      ),
      days: daysOf(days, counts.filter(current)),
      previousDays: daysOf(
        previousDays,
        counts.filter((row) => !current(row)),
      ),
      places: [...placeFigures.values()],
    };
  }

  // Each line sold or refunded in the period, as the summaries count them:
  // a payment on the day in India it was paid, a refund of the payment that
  // paid an order on the day it was made, up to when the summaries were
  // last rebuilt. With a filter, only its products' lines; without, each
  // order's delivery charge too. Oldest first. Null when longer than
  // MAX_REGISTER_LINES.
  private async register(
    tx: Prisma.TransactionClient,
    { from, to, ...asked }: SalesReportQuery,
    refreshedAt: Date | null,
  ): Promise<RegisterLine[] | null> {
    if (!refreshedAt) {
      return [];
    }
    const filter = filterOf(asked);
    const productId = filter?.productId ?? null;
    const categoryId = filter?.categoryId ?? null;
    const brandId = filter?.brandId ?? null;
    const place = placeParams(filter);
    const cutoff = utcText(refreshedAt);
    const rows = await tx.$queryRaw<RegisterRow[]>`
      WITH "events" AS (
        SELECT p."orderId", p."method", p."paidAt" AS "at", false AS "refunded"
          FROM "payments" p
         WHERE p."paidAt" >= ${from}::date - INTERVAL '330 minutes'
           AND p."paidAt" < (${to}::date + 1) - INTERVAL '330 minutes'
           AND p."paidAt" < ${cutoff}::timestamp
        UNION ALL
        SELECT p."orderId", p."method", r."createdAt", true
          FROM "refunds" r
          JOIN "payments" p ON p."razorpayPaymentId" = r."razorpayPaymentId"
         WHERE r."createdAt" >= ${from}::date - INTERVAL '330 minutes'
           AND r."createdAt" < (${to}::date + 1) - INTERVAL '330 minutes'
           AND r."createdAt" < ${cutoff}::timestamp
      )
      SELECT to_char(e."at" + INTERVAL '330 minutes', 'YYYY-MM-DD HH24:MI:SS') AS "at",
             e."at" AS "sortAt", e."refunded", o."reference",
             o."deliveryState" AS "state", e."method"::text AS "method",
             o."deliveryChargeRupees" AS "deliveryRupees",
             i."position", i."productName", i."sku", i."topCategoryName",
             i."subcategoryName", i."brandName", i."gstRate", i."packs",
             i."lineTotalRupees", i."gstRupees"
        FROM "events" e
        JOIN "orders" o ON o."id" = e."orderId"
        JOIN "order_items" i ON i."orderId" = o."id"
       WHERE (${productId}::uuid IS NULL OR i."productId" = ${productId}::uuid)
         AND (${categoryId}::uuid IS NULL
              OR i."topCategoryId" = ${categoryId}::uuid
              OR i."subcategoryId" = ${categoryId}::uuid)
         AND (${brandId}::uuid IS NULL OR i."brandId" = ${brandId}::uuid)
         AND (${place.state}::text IS NULL
              OR o."deliveryState" = ${place.state}::text)
         AND (NOT ${place.methodKept}
              OR e."method"::text IS NOT DISTINCT FROM ${place.method}::text)
       ORDER BY e."at", o."reference", e."refunded", i."position"
       LIMIT ${MAX_REGISTER_LINES + 1}`;

    const lines: RegisterLine[] = [];
    rows.forEach((row, i) => {
      const sign = row.refunded ? -1 : 1;
      const kind = row.refunded ? 'REFUND' : 'SALE';
      const event = {
        at: row.at,
        kind,
        reference: row.reference,
        state: row.state,
        method: row.method,
      } as const;
      lines.push({
        ...event,
        product: {
          name: row.productName,
          sku: row.sku,
          categoryName: row.topCategoryName,
          subcategoryName: row.subcategoryName,
          brandName: row.brandName,
          gstRate: row.gstRate,
        },
        packs: sign * row.packs,
        priceRupees: sign * (row.lineTotalRupees - row.gstRupees),
        gstRupees: sign * row.gstRupees,
        totalRupees: sign * row.lineTotalRupees,
      });
      // After an order's last line, its delivery charge: only when every
      // product is in, as it belongs to the whole order.
      const next = rows[i + 1];
      const lastOfEvent =
        !next ||
        next.sortAt.getTime() !== row.sortAt.getTime() ||
        next.reference !== row.reference ||
        next.refunded !== row.refunded;
      if (!keepsProducts(filter) && lastOfEvent && row.deliveryRupees > 0) {
        lines.push({
          ...event,
          product: null,
          packs: 0,
          priceRupees: sign * row.deliveryRupees,
          gstRupees: 0,
          totalRupees: sign * row.deliveryRupees,
        });
      }
    });
    return rows.length > MAX_REGISTER_LINES ? null : lines;
  }

  // What the filter is, by name: as the catalog names it now, else as it
  // last sold in the period.
  private async filtersOf(
    tx: Prisma.TransactionClient,
    filter: SalesFilter | null,
    lines: SoldLine[],
  ): Promise<SalesFilters> {
    const latestFirst = [...lines].sort(
      (a, b) => (b._max.day?.getTime() ?? 0) - (a._max.day?.getTime() ?? 0),
    );
    const soldAs = (pick: (line: SoldLine) => string | null) =>
      latestFirst.map(pick).find((name) => name !== null) ?? null;
    const { productId, categoryId, brandId, state, method } = filter ?? {};

    const product = productId
      ? await tx.product.findUnique({
          where: { id: productId },
          select: { name: true },
        })
      : null;
    const category = categoryId
      ? await tx.category.findUnique({
          where: { id: categoryId },
          select: { name: true, parent: { select: { name: true } } },
        })
      : null;
    const brand = brandId
      ? await tx.brand.findUnique({
          where: { id: brandId },
          select: { name: true },
        })
      : null;

    return {
      product: productId
        ? {
            productId,
            name:
              product?.name ??
              soldAs((line) =>
                line.productId === productId ? line.productName : null,
              ),
          }
        : null,
      category: categoryId
        ? {
            categoryId,
            name:
              category?.name ??
              soldAs((line) =>
                line.topCategoryId === categoryId
                  ? line.topCategoryName
                  : line.subcategoryId === categoryId
                    ? line.subcategoryName
                    : null,
              ),
            parentName: category
              ? (category.parent?.name ?? null)
              : soldAs((line) =>
                  line.subcategoryId === categoryId
                    ? line.topCategoryName
                    : null,
                ),
          }
        : null,
      brand: brandId
        ? {
            brandId,
            name:
              brand?.name ??
              soldAs((line) =>
                line.brandId === brandId ? line.brandName : null,
              ),
          }
        : null,
      state: state ? { state } : null,
      method: method
        ? { method: method === NOT_RECORDED ? null : method }
        : null,
    };
  }

  // The customers who paid in the period, and in the one before: new ones
  // paid for the first time ever in it, returning ones had paid before it.
  // Counted from the payments themselves, as the summaries keep no
  // customers. Days in India, as in the summaries (UTC+5:30). With a
  // filter, only those who bought one of its products, up to when the
  // summaries were last rebuilt; new still means new to the shop. Narrowed
  // to a state or a way of paying, those whose payment it was.
  private async customers(
    tx: Prisma.TransactionClient,
    { from, to, previousFrom }: Bounds,
    filter: SalesFilter | null,
    refreshedAt: Date | null,
  ): Promise<Customers> {
    const filtered = keepsProducts(filter);
    const cutoff = filtered && refreshedAt ? utcText(refreshedAt) : null;
    const productId = filter?.productId ?? null;
    const categoryId = filter?.categoryId ?? null;
    const brandId = filter?.brandId ?? null;
    const place = placeParams(filter);
    const rows = await tx.$queryRaw<
      { current: boolean; new: number; returning: number }[]
    >`
      WITH "bounds" AS (
        SELECT ${previousFrom}::date - INTERVAL '330 minutes' AS "before",
               ${from}::date - INTERVAL '330 minutes' AS "start",
               (${to}::date + 1) - INTERVAL '330 minutes' AS "end"
      ),
      "firsts" AS (
        SELECT o."userId", min(p."paidAt") AS "first"
          FROM "payments" p
          JOIN "orders" o ON o."id" = p."orderId"
         GROUP BY o."userId"
      ),
      "buyers" AS (
        SELECT DISTINCT o."userId", p."paidAt" >= n."start" AS "current"
          FROM "payments" p
          JOIN "orders" o ON o."id" = p."orderId"
         CROSS JOIN "bounds" n
         WHERE p."paidAt" >= n."before" AND p."paidAt" < n."end"
           AND (NOT ${filtered}
                OR (p."paidAt" < ${cutoff}::timestamp
                    AND EXISTS (
                      SELECT 1 FROM "order_items" i
                       WHERE i."orderId" = p."orderId"
                         AND (${productId}::uuid IS NULL
                              OR i."productId" = ${productId}::uuid)
                         AND (${categoryId}::uuid IS NULL
                              OR i."topCategoryId" = ${categoryId}::uuid
                              OR i."subcategoryId" = ${categoryId}::uuid)
                         AND (${brandId}::uuid IS NULL
                              OR i."brandId" = ${brandId}::uuid))))
           AND (${place.state}::text IS NULL
                OR o."deliveryState" = ${place.state}::text)
           AND (NOT ${place.methodKept}
                OR p."method"::text IS NOT DISTINCT FROM ${place.method}::text)
      )
      SELECT b."current",
             count(*) FILTER (WHERE f."first" >= CASE WHEN b."current"
                              THEN n."start" ELSE n."before" END)::int AS "new",
             count(*) FILTER (WHERE f."first" < CASE WHEN b."current"
                              THEN n."start" ELSE n."before" END)::int AS "returning"
        FROM "buyers" b
        JOIN "firsts" f ON f."userId" = b."userId"
       CROSS JOIN "bounds" n
       GROUP BY b."current"`;
    return {
      current: rows.find((row) => row.current),
      previous: rows.find((row) => !row.current),
    };
  }
}
