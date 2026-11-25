import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { PaymentMethod } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { SalesReportQuery } from './reports.schemas';
import {
  barOf,
  barsOf,
  dateOf,
  dayOf,
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
  deliveryRupees: number;
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

export interface SalesReport {
  period: Period;
  previousPeriod: Period;
  // When the summaries were last rebuilt; none before the first time.
  refreshedAt: Date | null;
  totals: SalesTotals;
  previousTotals: SalesTotals;
  // Each day's, week's or month's sales and orders, every one of them.
  series: {
    unit: SeriesUnit;
    points: { start: string; salesRupees: number; orders: number }[];
  };
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
  sales({ from, to }: SalesReportQuery): Promise<SalesReport> {
    return this.prisma.$transaction((tx) => this.read(tx, from, to), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async read(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
  ): Promise<SalesReport> {
    const previous = previousPeriod(from, to);
    const unit = unitFor(from, to);
    const inPeriod = { day: { gte: dateOf(from), lte: dateOf(to) } };

    const refresh = await tx.salesSummaryRefresh.findUnique({
      where: { id: 1 },
      select: { refreshedAt: true },
    });
    const now = await tx.dailyOrderSale.aggregate({
      where: inPeriod,
      _sum: ORDER_SUMS,
    });
    const before = await tx.dailyOrderSale.aggregate({
      where: {
        day: { gte: dateOf(previous.from), lte: dateOf(previous.to) },
      },
      _sum: ORDER_SUMS,
    });
    const days = await tx.dailyOrderSale.groupBy({
      by: ['day'],
      where: inPeriod,
      _sum: ORDER_SUMS,
    });
    const places = await tx.dailyOrderSale.groupBy({
      by: ['deliveryState', 'method'],
      where: inPeriod,
      _sum: ORDER_SUMS,
    });
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
      where: inPeriod,
      _sum: LINE_SUMS,
      _max: { day: true },
    });
    const customers = await this.customers(tx, from, to, previous.from);

    const points = new Map(
      barsOf(from, to, unit).map((start) => [
        start,
        { start, salesRupees: 0, orders: 0 },
      ]),
    );
    for (const row of days) {
      const point = points.get(barOf(dayOf(row.day), unit, from));
      if (point) {
        point.salesRupees += orderSales(row._sum);
        point.orders += zero(row._sum.soldOrders);
      }
    }

    const states = new Map<string, SalesReport['states'][number]>();
    const methods = new Map<string, SalesReport['methods'][number]>();
    for (const row of places) {
      const state = states.get(row.deliveryState) ?? {
        state: row.deliveryState,
        salesRupees: 0,
        orders: 0,
      };
      const method = methods.get(row.method ?? '') ?? {
        method: row.method,
        salesRupees: 0,
        orders: 0,
      };
      for (const found of [state, method]) {
        found.salesRupees += orderSales(row._sum);
        found.orders += zero(row._sum.soldOrders);
      }
      states.set(row.deliveryState, state);
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

    return {
      period: { from, to },
      previousPeriod: previous,
      refreshedAt: refresh?.refreshedAt ?? null,
      totals: totalsOf(now._sum, customers.current),
      previousTotals: totalsOf(before._sum, customers.previous),
      series: { unit, points: [...points.values()] },
      products: ranked(products.values(), byName)
        .slice(0, TOP_LIMIT)
        .map(({ productId, name, salesRupees, packs }) => ({
          productId,
          name,
          salesRupees,
          packs,
        })),
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
      brands: ranked(brands.values(), byName)
        .slice(0, TOP_LIMIT)
        .map(({ brandId, name, recorded, salesRupees }) => ({
          brandId,
          name,
          recorded,
          salesRupees,
        })),
      states: ranked(states.values(), (state) => state.state),
      methods: ranked(methods.values(), (method) => method.method),
    };
  }

  // The customers who paid in the period, and in the one before: new ones
  // paid for the first time ever in it, returning ones had paid before it.
  // Counted from the payments themselves, as the summaries keep no
  // customers. Days in India, as in the summaries (UTC+5:30).
  private async customers(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
    previousFrom: string,
  ) {
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
