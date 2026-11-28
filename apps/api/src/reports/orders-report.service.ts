import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { RefundReason, RefundStatus } from '../generated/prisma/client';
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
  type SalesFilter,
  type SalesFilters,
  SalesReportService,
} from './sales-report.service';

// The orders placed in some days (part 15E), by where each is now.
export interface OrderCounts {
  placed: number;
  // Of them, those paid for, whatever became of them after.
  paid: number;
  waitingForPayment: number;
  // Paid, to pack.
  toPack: number;
  // Packed, for the courier.
  toShip: number;
  // With the courier.
  onTheWay: number;
  delivered: number;
  // Not paid in time.
  expired: number;
  // Cancelled, and by whom: the customer or a Super User, before paying,
  // or after, when the payment went back in full.
  cancelled: number;
  customerCancelledUnpaid: number;
  customerCancelledPaid: number;
  staffCancelledUnpaid: number;
  staffCancelledPaid: number;
}

const COUNTS: readonly (keyof OrderCounts)[] = [
  'placed',
  'paid',
  'waitingForPayment',
  'toPack',
  'toShip',
  'onTheWay',
  'delivered',
  'expired',
  'cancelled',
  'customerCancelledUnpaid',
  'customerCancelledPaid',
  'staffCancelledUnpaid',
  'staffCancelledPaid',
];

// The orders at one step now, and since when the oldest has waited there.
export interface Waiting {
  orders: number;
  since: Date | null;
}

// The refunds not finished now, what they come to, and since when the
// oldest was asked for.
export interface WaitingRefunds {
  refunds: number;
  rupees: number;
  since: Date | null;
}

// How a refund is now: its status, or given back by hand once it failed
// (ADR 0038).
export type RefundShown = RefundStatus | 'GIVEN_BACK';

export const REFUND_SHOWN: readonly RefundShown[] = [
  'PROCESSED',
  'PENDING',
  'REQUESTED',
  'FAILED',
  'GIVEN_BACK',
];
export const REFUND_REASONS: readonly RefundReason[] = [
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_STAFF',
  'ORDER_EXPIRED',
  'ORDER_CANCELLED',
  'ALREADY_PAID',
];

export interface RefundCount {
  refunds: number;
  rupees: number;
}

export interface OrdersReport {
  period: Period;
  previousPeriod: Period;
  filters: SalesFilters;
  // When the orders were read: everything here is live.
  readAt: Date;
  // Now, whatever the period: the orders waiting at each step, and the
  // refunds not finished, those on their way and those that failed and
  // wait to be given back by hand.
  waiting: {
    payment: Waiting;
    toPack: Waiting;
    toShip: Waiting;
    onTheWay: Waiting;
    refunds: WaitingRefunds;
    failedRefunds: WaitingRefunds;
  };
  // The orders placed in the period, and in the one before, by where each
  // is now.
  totals: OrderCounts;
  previousTotals: OrderCounts;
  // Each bar's orders, beside those placed on the same days of the period
  // before: as many days earlier as the period is long.
  series: {
    unit: SeriesUnit;
    points: ({ start: string; previous: OrderCounts } & OrderCounts)[];
  };
  // The refunds asked for in the period, every one whatever its reason: by
  // how each is now, and by why, each in a fixed order, those with none
  // too.
  refunds: {
    byStatus: ({ status: RefundShown } & RefundCount)[];
    byReason: ({ reason: RefundReason } & RefundCount)[];
  };
}

type DayCounts = { day: string } & OrderCounts;

const none = (): OrderCounts =>
  Object.fromEntries(COUNTS.map((key) => [key, 0])) as unknown as OrderCounts;

// The orders placed in some days, both included.
function countsIn(
  byDay: Map<string, OrderCounts>,
  from: string,
  to: string,
): OrderCounts {
  const counts = none();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const some = byDay.get(day);
    if (some) {
      for (const key of COUNTS) {
        counts[key] += some[key];
      }
    }
  }
  return counts;
}

// The orders a filter keeps, with `o` an order and `p` its payment: those
// with one of its products, or that went to its state, or that were paid
// its way. Paid a way only once paid: an unpaid order has no way yet.
export function keptOrders(filter: SalesFilter | null): Prisma.Sql {
  const productId = filter?.productId ?? null;
  const categoryId = filter?.categoryId ?? null;
  const brandId = filter?.brandId ?? null;
  const place = placeParams(filter);
  return Prisma.sql`(NOT ${keepsProducts(filter)}
          OR EXISTS (
            SELECT 1 FROM "order_items" i
             WHERE i."orderId" = o."id"
               AND (${productId}::uuid IS NULL
                    OR i."productId" = ${productId}::uuid)
               AND (${categoryId}::uuid IS NULL
                    OR i."topCategoryId" = ${categoryId}::uuid
                    OR i."subcategoryId" = ${categoryId}::uuid)
               AND (${brandId}::uuid IS NULL
                    OR i."brandId" = ${brandId}::uuid)))
     AND (${place.state}::text IS NULL
          OR o."deliveryState" = ${place.state}::text)
     AND (NOT ${place.methodKept}
          OR (p."paidAt" IS NOT NULL
              AND p."method"::text IS NOT DISTINCT FROM ${place.method}::text))`;
}

@Injectable()
export class OrdersReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesReportService,
  ) {}

  // The orders of a period for Super Users (part 15E), read live from the
  // orders, payments, refunds and the audit log, narrowed as the sales
  // report is. In one snapshot.
  orders(query: SalesReportQuery, now = new Date()): Promise<OrdersReport> {
    return this.prisma.$transaction(async (tx) => this.read(tx, query, now), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async read(
    tx: Prisma.TransactionClient,
    { from, to, ...asked }: SalesReportQuery,
    now: Date,
  ): Promise<OrdersReport> {
    const previous = previousPeriod(from, to);
    const unit = asked.unit ?? unitFor(from, to);
    const length = daysIn(from, to);
    const filter = filterOf(asked);
    const kept = keptOrders(filter);

    const days = await this.placed(tx, previous.from, to, kept);
    const byDay = new Map<string, OrderCounts>(
      days.map(({ day, ...counts }) => [day, counts]),
    );
    const starts = barsOf(from, to, unit);
    const points = starts.map((start, i) => {
      const next = starts[i + 1];
      const end = next ? addDays(next, -1) : to;
      return {
        start,
        ...countsIn(byDay, start, end),
        previous: countsIn(
          byDay,
          addDays(start, -length),
          addDays(end, -length),
        ),
      };
    });

    return {
      period: { from, to },
      previousPeriod: previous,
      filters: await this.sales.filtersOf(tx, filter, []),
      readAt: now,
      waiting: await this.waiting(tx, kept),
      totals: countsIn(byDay, from, to),
      previousTotals: countsIn(byDay, previous.from, previous.to),
      series: { unit, points },
      refunds: await this.refunds(tx, from, to, kept),
    };
  }

  // Each day's orders, placed on it in India, by where each is now. A
  // cancelled one's canceller: the refund's reason once paid, as the
  // database keeps a paid order cancelled only with its payment going back;
  // before paying, a Super User when the audit log has their cancel, else
  // the customer.
  private placed(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
    kept: Prisma.Sql,
  ): Promise<DayCounts[]> {
    return tx.$queryRaw<DayCounts[]>`
      WITH "placed" AS (
        SELECT o."createdAt", o."status", p."paidAt", c."reason" AS "cancelReason",
               EXISTS (
                 SELECT 1 FROM "audit_log" a
                  WHERE a."action" = 'order.cancelled'
                    AND lower(a."targetId") = o."id"::text) AS "byStaff"
          FROM "orders" o
          LEFT JOIN "payments" p ON p."orderId" = o."id"
          LEFT JOIN "refunds" c
            ON c."paymentId" = p."id"
           AND c."razorpayPaymentId" = p."razorpayPaymentId"
           AND c."reason" IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF')
         WHERE o."createdAt" >= ${from}::date - INTERVAL '330 minutes'
           AND o."createdAt" < (${to}::date + 1) - INTERVAL '330 minutes'
           AND ${kept}
      )
      SELECT to_char(("createdAt" + INTERVAL '330 minutes')::date, 'YYYY-MM-DD') AS "day",
             count(*)::int AS "placed",
             (count(*) FILTER (WHERE "paidAt" IS NOT NULL))::int AS "paid",
             (count(*) FILTER (WHERE "status" = 'PENDING_PAYMENT'))::int AS "waitingForPayment",
             (count(*) FILTER (WHERE "status" = 'PAID'))::int AS "toPack",
             (count(*) FILTER (WHERE "status" = 'PACKED'))::int AS "toShip",
             (count(*) FILTER (WHERE "status" = 'SHIPPED'))::int AS "onTheWay",
             (count(*) FILTER (WHERE "status" = 'DELIVERED'))::int AS "delivered",
             (count(*) FILTER (WHERE "status" = 'EXPIRED'))::int AS "expired",
             (count(*) FILTER (WHERE "status" = 'CANCELLED'))::int AS "cancelled",
             (count(*) FILTER (WHERE "status" = 'CANCELLED' AND "paidAt" IS NULL
                                     AND NOT "byStaff"))::int AS "customerCancelledUnpaid",
             (count(*) FILTER (WHERE "status" = 'CANCELLED'
                                     AND "cancelReason" = 'CANCELLED_BY_CUSTOMER'))::int AS "customerCancelledPaid",
             (count(*) FILTER (WHERE "status" = 'CANCELLED' AND "paidAt" IS NULL
                                     AND "byStaff"))::int AS "staffCancelledUnpaid",
             (count(*) FILTER (WHERE "status" = 'CANCELLED'
                                     AND "cancelReason" = 'CANCELLED_BY_STAFF'))::int AS "staffCancelledPaid"
        FROM "placed"
       GROUP BY 1`;
  }

  // The orders waiting now at each step, and since when the oldest has
  // waited: placed, paid, packed or shipped. The refunds not finished,
  // and those failed and not given back by hand yet.
  private async waiting(
    tx: Prisma.TransactionClient,
    kept: Prisma.Sql,
  ): Promise<OrdersReport['waiting']> {
    const steps = await tx.$queryRaw<
      { status: string; orders: number; since: Date | null }[]
    >`
      SELECT o."status"::text AS "status", count(*)::int AS "orders",
             min(CASE o."status"
                   WHEN 'PENDING_PAYMENT' THEN o."createdAt"
                   WHEN 'PAID' THEN p."paidAt"
                   WHEN 'PACKED' THEN o."packedAt"
                   ELSE o."shippedAt"
                 END) AS "since"
        FROM "orders" o
        LEFT JOIN "payments" p ON p."orderId" = o."id"
       WHERE o."status" IN ('PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED')
         AND ${kept}
       GROUP BY o."status"`;
    const refunds = await tx.$queryRaw<
      { failed: boolean; refunds: number; rupees: number; since: Date | null }[]
    >`
      SELECT (r."status" = 'FAILED') AS "failed", count(*)::int AS "refunds",
             sum(r."amountRupees")::int AS "rupees", min(r."createdAt") AS "since"
        FROM "refunds" r
        JOIN "payments" p ON p."id" = r."paymentId"
        JOIN "orders" o ON o."id" = p."orderId"
       WHERE (r."status" IN ('REQUESTED', 'PENDING')
              OR (r."status" = 'FAILED' AND r."givenBackAt" IS NULL))
         AND ${kept}
       GROUP BY 1`;
    const step = (status: string): Waiting => {
      const row = steps.find((each) => each.status === status);
      return { orders: row?.orders ?? 0, since: row?.since ?? null };
    };
    const owed = (failed: boolean): WaitingRefunds => {
      const row = refunds.find((each) => each.failed === failed);
      return {
        refunds: row?.refunds ?? 0,
        rupees: row?.rupees ?? 0,
        since: row?.since ?? null,
      };
    };
    return {
      payment: step('PENDING_PAYMENT'),
      toPack: step('PAID'),
      toShip: step('PACKED'),
      onTheWay: step('SHIPPED'),
      refunds: owed(false),
      failedRefunds: owed(true),
    };
  }

  // The refunds asked for in the period, on their day in India, by how
  // each is now and by why.
  private async refunds(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
    kept: Prisma.Sql,
  ): Promise<OrdersReport['refunds']> {
    const rows = await tx.$queryRaw<
      {
        status: RefundShown;
        reason: RefundReason;
        refunds: number;
        rupees: number;
      }[]
    >`
      SELECT (CASE WHEN r."givenBackAt" IS NOT NULL THEN 'GIVEN_BACK'
                   ELSE r."status"::text END) AS "status",
             r."reason"::text AS "reason", count(*)::int AS "refunds",
             sum(r."amountRupees")::int AS "rupees"
        FROM "refunds" r
        JOIN "payments" p ON p."id" = r."paymentId"
        JOIN "orders" o ON o."id" = p."orderId"
       WHERE r."createdAt" >= ${from}::date - INTERVAL '330 minutes'
         AND r."createdAt" < (${to}::date + 1) - INTERVAL '330 minutes'
         AND ${kept}
       GROUP BY 1, 2`;
    const total = (some: typeof rows): RefundCount => ({
      refunds: some.reduce((sum, row) => sum + row.refunds, 0),
      rupees: some.reduce((sum, row) => sum + row.rupees, 0),
    });
    return {
      byStatus: REFUND_SHOWN.map((status) => ({
        status,
        ...total(rows.filter((row) => row.status === status)),
      })),
      byReason: REFUND_REASONS.map((reason) => ({
        reason,
        ...total(rows.filter((row) => row.reason === reason)),
      })),
    };
  }
}
