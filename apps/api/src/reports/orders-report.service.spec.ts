import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  keptOrders,
  OrdersReportService,
  type OrderCounts,
} from './orders-report.service';
import { SalesReportService } from './sales-report.service';

const P1 = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b41';
const NOW = new Date('2026-11-25T06:45:00.000Z');
const NOVEMBER = { from: '2026-11-01', to: '2026-11-25' };
const NO_FILTERS = {
  product: null,
  category: null,
  brand: null,
  state: null,
  method: null,
};

const counts = (some: Partial<OrderCounts>): OrderCounts => ({
  placed: 0,
  paid: 0,
  waitingForPayment: 0,
  toPack: 0,
  toShip: 0,
  onTheWay: 0,
  delivered: 0,
  expired: 0,
  cancelled: 0,
  customerCancelledUnpaid: 0,
  customerCancelledPaid: 0,
  staffCancelledUnpaid: 0,
  staffCancelledPaid: 0,
  ...some,
});

// The orders placed from 7 October to 25 November, by the day placed.
const DAYS = [
  {
    day: '2026-10-08',
    ...counts({ placed: 2, paid: 1, delivered: 1, expired: 1 }),
  },
  {
    day: '2026-11-02',
    ...counts({
      placed: 3,
      paid: 2,
      delivered: 1,
      cancelled: 2,
      customerCancelledUnpaid: 1,
      staffCancelledPaid: 1,
    }),
  },
  // A Monday: the first day of its week's bar, never the last of the one
  // before.
  {
    day: '2026-11-16',
    ...counts({ placed: 1, paid: 1, delivered: 1 }),
  },
  {
    day: '2026-11-20',
    ...counts({ placed: 4, paid: 3, toPack: 2, onTheWay: 1, expired: 1 }),
  },
  {
    day: '2026-11-25',
    ...counts({
      placed: 2,
      paid: 1,
      waitingForPayment: 1,
      toShip: 1,
    }),
  },
];
const STEPS = [
  { status: 'PAID', orders: 2, since: new Date('2026-11-20T04:00:00.000Z') },
  {
    status: 'SHIPPED',
    orders: 1,
    since: new Date('2026-11-21T10:00:00.000Z'),
  },
  {
    status: 'PENDING_PAYMENT',
    orders: 1,
    since: new Date('2026-11-25T06:40:00.000Z'),
  },
];
const OWED = [
  {
    failed: true,
    refunds: 1,
    rupees: 499,
    since: new Date('2026-11-21T09:00:00.000Z'),
  },
];
const REFUNDS = [
  {
    status: 'PROCESSED',
    reason: 'CANCELLED_BY_STAFF',
    refunds: 1,
    rupees: 548,
  },
  {
    status: 'PROCESSED',
    reason: 'ALREADY_PAID',
    refunds: 2,
    rupees: 900,
  },
  { status: 'GIVEN_BACK', reason: 'ORDER_EXPIRED', refunds: 1, rupees: 120 },
];

const sqlOf = (strings: TemplateStringsArray) => strings.join('?');

function setup() {
  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = sqlOf(strings);
      return Promise.resolve(
        sql.includes('WITH "placed"')
          ? DAYS
          : sql.includes('"failed"')
            ? OWED
            : sql.includes('GIVEN_BACK')
              ? REFUNDS
              : STEPS,
      );
    }),
  };
  const prisma = {
    $transaction: jest.fn(
      (work: (client: typeof tx) => Promise<unknown>, _options: object) =>
        work(tx),
    ),
  };
  const sales = { filtersOf: jest.fn().mockResolvedValue(NO_FILTERS) };
  const reports = new OrdersReportService(
    prisma as unknown as PrismaService,
    sales as unknown as SalesReportService,
  );
  return { reports, prisma, tx, sales };
}

// The values a query was given, by the words in it, and the filter's part.
function valuesOf(tx: ReturnType<typeof setup>['tx'], words: string) {
  const call = tx.$queryRaw.mock.calls.find(([strings]) =>
    sqlOf(strings).includes(words),
  ) as [TemplateStringsArray, ...unknown[]] | undefined;
  if (!call) {
    throw new Error(`no query with ${words}`);
  }
  const [, ...values] = call;
  const kept = values.find((value) => value instanceof Prisma.Sql);
  return {
    values: values.filter((value) => !(value instanceof Prisma.Sql)),
    kept: kept as Prisma.Sql | undefined,
  };
}

describe('OrdersReportService.orders', () => {
  it('reads live in one snapshot, the period and the one of the same length before', async () => {
    const { reports, prisma, sales, tx } = setup();

    const report = await reports.orders(NOVEMBER, NOW);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
    expect(report.period).toEqual(NOVEMBER);
    expect(report.previousPeriod).toEqual({
      from: '2026-10-07',
      to: '2026-10-31',
    });
    expect(report.readAt).toBe(NOW);
    expect(report.filters).toBe(NO_FILTERS);
    expect(sales.filtersOf).toHaveBeenCalledWith(tx, null, []);
    // The orders placed from the start of the period before; the refunds
    // asked for in the period.
    expect(valuesOf(tx, 'WITH "placed"').values).toEqual([
      '2026-10-07',
      '2026-11-25',
    ]);
    expect(valuesOf(tx, 'GIVEN_BACK').values).toEqual([
      '2026-11-01',
      '2026-11-25',
    ]);
  });

  it('counts the orders placed in the period and the one before, by where each is now', async () => {
    const { reports } = setup();

    const report = await reports.orders(NOVEMBER, NOW);
    expect(report.totals).toEqual(
      counts({
        placed: 10,
        paid: 7,
        waitingForPayment: 1,
        toPack: 2,
        toShip: 1,
        onTheWay: 1,
        delivered: 2,
        expired: 1,
        cancelled: 2,
        customerCancelledUnpaid: 1,
        staffCancelledPaid: 1,
      }),
    );
    expect(report.previousTotals).toEqual(
      counts({ placed: 2, paid: 1, delivered: 1, expired: 1 }),
    );
  });

  it('gives each bar its orders, beside those placed on the same days of the period before', async () => {
    const { reports } = setup();

    const report = await reports.orders({ ...NOVEMBER, unit: 'week' }, NOW);
    expect(report.series.unit).toBe('week');
    const points = report.series.points;
    expect(points.map((point) => point.start)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
    ]);
    // 2–8 Nov, beside 8–14 Oct: 25 days earlier.
    expect(points[1]?.placed).toBe(3);
    expect(points[1]?.staffCancelledPaid).toBe(1);
    expect(points[1]?.previous).toEqual(
      counts({ placed: 2, paid: 1, delivered: 1, expired: 1 }),
    );
    // 9–15 Nov ends the day before the next bar starts.
    expect(points[2]?.placed).toBe(0);
    expect(points[3]?.placed).toBe(5);
    expect(points[3]?.toPack).toBe(2);
    expect(points[4]?.waitingForPayment).toBe(1);
    expect(points[4]?.previous).toEqual(counts({}));
    expect(points.reduce((sum, point) => sum + point.placed, 0)).toBe(
      report.totals.placed,
    );
  });

  it('draws its bars as the period asks when no size is given', async () => {
    const { reports } = setup();

    const report = await reports.orders(NOVEMBER, NOW);
    expect(report.series.unit).toBe('day');
    expect(report.series.points).toHaveLength(25);
    expect(report.series.points[19]).toMatchObject({
      start: '2026-11-20',
      placed: 4,
    });
  });

  it('tells what waits now at each step, since when, and the refunds not finished', async () => {
    const { reports } = setup();

    const report = await reports.orders(NOVEMBER, NOW);
    expect(report.waiting).toEqual({
      payment: { orders: 1, since: new Date('2026-11-25T06:40:00.000Z') },
      toPack: { orders: 2, since: new Date('2026-11-20T04:00:00.000Z') },
      toShip: { orders: 0, since: null },
      onTheWay: { orders: 1, since: new Date('2026-11-21T10:00:00.000Z') },
      refunds: { refunds: 0, rupees: 0, since: null },
      failedRefunds: {
        refunds: 1,
        rupees: 499,
        since: new Date('2026-11-21T09:00:00.000Z'),
      },
    });
  });

  it('counts the period’s refunds by how each is now and by why, every one in a fixed order', async () => {
    const { reports } = setup();

    const report = await reports.orders(NOVEMBER, NOW);
    expect(report.refunds.byStatus).toEqual([
      { status: 'PROCESSED', refunds: 3, rupees: 1448 },
      { status: 'PENDING', refunds: 0, rupees: 0 },
      { status: 'REQUESTED', refunds: 0, rupees: 0 },
      { status: 'FAILED', refunds: 0, rupees: 0 },
      { status: 'GIVEN_BACK', refunds: 1, rupees: 120 },
    ]);
    expect(report.refunds.byReason).toEqual([
      { reason: 'CANCELLED_BY_CUSTOMER', refunds: 0, rupees: 0 },
      { reason: 'CANCELLED_BY_STAFF', refunds: 1, rupees: 548 },
      { reason: 'ORDER_EXPIRED', refunds: 1, rupees: 120 },
      { reason: 'ORDER_CANCELLED', refunds: 0, rupees: 0 },
      { reason: 'ALREADY_PAID', refunds: 2, rupees: 900 },
    ]);
  });

  it('narrows every part as the sales report is', async () => {
    const { reports, sales, tx } = setup();

    await reports.orders(
      { ...NOVEMBER, productId: P1, state: 'Kerala', method: 'UPI' },
      NOW,
    );
    expect(sales.filtersOf).toHaveBeenCalledWith(
      tx,
      {
        productId: P1,
        categoryId: undefined,
        brandId: undefined,
        state: 'Kerala',
        method: 'UPI',
      },
      [],
    );
    for (const words of [
      'WITH "placed"',
      '"failed"',
      'GIVEN_BACK',
      "WHEN 'PACKED'",
    ]) {
      expect(valuesOf(tx, words).kept?.values).toEqual([
        true,
        P1,
        P1,
        null,
        null,
        null,
        null,
        null,
        'Kerala',
        'Kerala',
        true,
        'UPI',
      ]);
    }
  });
});

describe('keptOrders', () => {
  it('keeps every order when not narrowed', () => {
    expect(keptOrders(null).values).toEqual([
      false,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
    ]);
  });

  it('keeps those of a category or its subcategories, and those paid a way not recorded only once paid', () => {
    const kept = keptOrders({ categoryId: P1, method: 'NOT_RECORDED' });
    expect(kept.values).toEqual([
      true,
      null,
      null,
      P1,
      P1,
      P1,
      null,
      null,
      null,
      null,
      true,
      null,
    ]);
    expect(kept.sql).toContain('i."subcategoryId" = ?::uuid');
    expect(kept.sql).toContain('p."paidAt" IS NOT NULL');
  });
});
