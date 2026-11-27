import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SalesReportQuery } from './reports.schemas';
import {
  addDays,
  barsOf,
  daysIn,
  previousPeriod,
  type SeriesUnit,
  unitFor,
} from './sales-periods';
import {
  filterOf,
  keepsProducts,
  type Period,
  placeParams,
  SalesReportService,
  type SalesFilters,
  TOP_LIMIT,
  utcText,
} from './sales-report.service';

// A period's customers (part 15E), as the Sales page counts them: those who
// paid for an order in it, new if they paid for the first time ever in it,
// returning if they had paid before.
export interface CustomerCounts {
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  // Of them, those who paid for more than one order in it.
  boughtAgain: number;
  // The customers' accounts made in it, whether they paid or not. Never
  // narrowed: an account has no products, state or way of paying.
  accountsMade: number;
}

export interface CustomersReport {
  period: Period;
  previousPeriod: Period;
  filters: SalesFilters;
  // When the sales summaries were last rebuilt; none before the first time.
  refreshedAt: Date | null;
  totals: CustomerCounts;
  previousTotals: CustomerCounts;
  // Each bar's customers, beside the same days of the period before: as
  // many days earlier as the period is long.
  series: {
    unit: SeriesUnit;
    points: ({ start: string; previous: CustomerCounts } & CustomerCounts)[];
  };
  // The customers who bought the most in the period: what their products
  // came to without GST, less refunds, and their orders paid. For Super
  // Users on the page only, never in a download (the owner's choice,
  // 2026-11-27).
  topCustomers: {
    userId: string;
    name: string;
    email: string;
    orders: number;
    salesRupees: number;
  }[];
}

// A payment for an order, on its day in India, with when its customer
// first paid for anything.
interface Payment {
  day: string;
  userId: string;
  orderId: string;
  firstDay: string;
}

// Every day from one to another, both included.
function* daysFrom(from: string, to: string): Generator<string> {
  for (let day = from; day <= to; day = addDays(day, 1)) {
    yield day;
  }
}

// The customers of some days: who paid, which orders, new or not.
function countsIn(
  byDay: Map<string, Payment[]>,
  accounts: Map<string, number>,
  from: string,
  to: string,
): CustomerCounts {
  const orders = new Map<string, Set<string>>();
  const firsts = new Map<string, string>();
  let accountsMade = 0;
  for (const day of daysFrom(from, to)) {
    accountsMade += accounts.get(day) ?? 0;
    for (const payment of byDay.get(day) ?? []) {
      const paid = orders.get(payment.userId) ?? new Set<string>();
      paid.add(payment.orderId);
      orders.set(payment.userId, paid);
      firsts.set(payment.userId, payment.firstDay);
    }
  }
  let newCustomers = 0;
  let boughtAgain = 0;
  for (const [userId, paid] of orders) {
    if ((firsts.get(userId) ?? '') >= from) {
      newCustomers += 1;
    }
    if (paid.size > 1) {
      boughtAgain += 1;
    }
  }
  return {
    customers: orders.size,
    newCustomers,
    returningCustomers: orders.size - newCustomers,
    boughtAgain,
    accountsMade,
  };
}

@Injectable()
export class CustomersReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesReportService,
  ) {}

  // The customers of a period for Super Users (part 15E), from the
  // payments, refunds and accounts themselves, narrowed as the sales report
  // is: to the customers who bought a product, a category or a brand (up to
  // when the summaries were last rebuilt, as there), or whose orders went
  // to a state or were paid one way. In one snapshot.
  customers(query: SalesReportQuery): Promise<CustomersReport> {
    return this.prisma.$transaction(async (tx) => this.read(tx, query), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async read(
    tx: Prisma.TransactionClient,
    { from, to, ...asked }: SalesReportQuery,
  ): Promise<CustomersReport> {
    const previous = previousPeriod(from, to);
    const unit = asked.unit ?? unitFor(from, to);
    const length = daysIn(from, to);
    const filter = filterOf(asked);
    const refresh = await tx.salesSummaryRefresh.findUnique({
      where: { id: 1 },
      select: { refreshedAt: true },
    });
    const refreshedAt = refresh?.refreshedAt ?? null;

    const payments = await this.payments(
      tx,
      previous.from,
      to,
      filter,
      refreshedAt,
    );
    const byDay = new Map<string, Payment[]>();
    for (const payment of payments) {
      const day = byDay.get(payment.day) ?? [];
      day.push(payment);
      byDay.set(payment.day, day);
    }
    const accountRows = await tx.$queryRaw<{ day: string; accounts: number }[]>`
      SELECT to_char((u."createdAt" + INTERVAL '330 minutes')::date, 'YYYY-MM-DD') AS "day",
             count(*)::int AS "accounts"
        FROM "users" u
       WHERE u."role" = 'CUSTOMER'
         AND u."createdAt" >= ${previous.from}::date - INTERVAL '330 minutes'
         AND u."createdAt" < (${to}::date + 1) - INTERVAL '330 minutes'
       GROUP BY 1`;
    const accounts = new Map(accountRows.map((row) => [row.day, row.accounts]));

    const starts = barsOf(from, to, unit);
    const points = starts.map((start, i) => {
      const next = starts[i + 1];
      const end = next ? addDays(next, -1) : to;
      return {
        start,
        ...countsIn(byDay, accounts, start, end),
        previous: countsIn(
          byDay,
          accounts,
          addDays(start, -length),
          addDays(end, -length),
        ),
      };
    });

    return {
      period: { from, to },
      previousPeriod: previous,
      filters: await this.sales.filtersOf(tx, filter, []),
      refreshedAt,
      totals: countsIn(byDay, accounts, from, to),
      previousTotals: countsIn(byDay, accounts, previous.from, previous.to),
      series: { unit, points },
      topCustomers: await this.topCustomers(tx, from, to, filter, refreshedAt),
    };
  }

  // Each payment of the period and the one before, as the sales report
  // counts customers: narrowed to some products, only up to when the
  // summaries were last rebuilt, and none before the first time.
  private payments(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
    filter: ReturnType<typeof filterOf>,
    refreshedAt: Date | null,
  ): Promise<Payment[]> {
    const narrowed = keepsProducts(filter);
    const cutoff = narrowed && refreshedAt ? utcText(refreshedAt) : null;
    const productId = filter?.productId ?? null;
    const categoryId = filter?.categoryId ?? null;
    const brandId = filter?.brandId ?? null;
    const place = placeParams(filter);
    return tx.$queryRaw<Payment[]>`
      WITH "firsts" AS (
        SELECT o."userId", min(p."paidAt") AS "first"
          FROM "payments" p
          JOIN "orders" o ON o."id" = p."orderId"
         GROUP BY o."userId"
      )
      SELECT to_char((p."paidAt" + INTERVAL '330 minutes')::date, 'YYYY-MM-DD') AS "day",
             o."userId"::text AS "userId", o."id"::text AS "orderId",
             to_char((f."first" + INTERVAL '330 minutes')::date, 'YYYY-MM-DD') AS "firstDay"
        FROM "payments" p
        JOIN "orders" o ON o."id" = p."orderId"
        JOIN "firsts" f ON f."userId" = o."userId"
       WHERE p."paidAt" >= ${from}::date - INTERVAL '330 minutes'
         AND p."paidAt" < (${to}::date + 1) - INTERVAL '330 minutes'
         AND (NOT ${narrowed}
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
              OR p."method"::text IS NOT DISTINCT FROM ${place.method}::text)`;
  }

  // The best customers of the period, by what their products came to
  // without GST, less refunds, as the sales summaries count it: payments on
  // their day in India, refunds of the payment that paid on theirs, up to
  // when the summaries were last rebuilt, so their sales agree with the
  // Sales page's. Narrowed, only the lines and orders the filter keeps.
  // None before the summaries were ever made.
  private async topCustomers(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
    filter: ReturnType<typeof filterOf>,
    refreshedAt: Date | null,
  ): Promise<CustomersReport['topCustomers']> {
    if (!refreshedAt) {
      return [];
    }
    const cutoff = utcText(refreshedAt);
    const productId = filter?.productId ?? null;
    const categoryId = filter?.categoryId ?? null;
    const brandId = filter?.brandId ?? null;
    const place = placeParams(filter);
    return tx.$queryRaw<CustomersReport['topCustomers']>`
      WITH "events" AS (
        SELECT p."orderId", p."method", false AS "refunded"
          FROM "payments" p
         WHERE p."paidAt" >= ${from}::date - INTERVAL '330 minutes'
           AND p."paidAt" < (${to}::date + 1) - INTERVAL '330 minutes'
           AND p."paidAt" < ${cutoff}::timestamp
        UNION ALL
        SELECT p."orderId", p."method", true
          FROM "refunds" r
          JOIN "payments" p ON p."razorpayPaymentId" = r."razorpayPaymentId"
         WHERE r."createdAt" >= ${from}::date - INTERVAL '330 minutes'
           AND r."createdAt" < (${to}::date + 1) - INTERVAL '330 minutes'
           AND r."createdAt" < ${cutoff}::timestamp
      )
      SELECT u."id"::text AS "userId", u."fullName" AS "name", u."email",
             (count(DISTINCT e."orderId") FILTER (WHERE NOT e."refunded"))::int AS "orders",
             sum(CASE WHEN e."refunded" THEN -1 ELSE 1 END
                 * (i."lineTotalRupees" - i."gstRupees"))::int AS "salesRupees"
        FROM "events" e
        JOIN "orders" o ON o."id" = e."orderId"
        JOIN "users" u ON u."id" = o."userId"
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
       GROUP BY u."id", u."fullName", u."email"
       ORDER BY "salesRupees" DESC, u."fullName", u."id"
       LIMIT ${TOP_LIMIT}`;
  }
}
