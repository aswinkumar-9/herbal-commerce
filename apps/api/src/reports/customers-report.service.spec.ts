import { PrismaService } from '../prisma/prisma.service';
import { CustomersReportService } from './customers-report.service';
import { SalesReportService, TOP_LIMIT } from './sales-report.service';

const P1 = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b41';
const REFRESHED = new Date('2026-11-25T06:40:00.000Z');
const NOVEMBER = { from: '2026-11-01', to: '2026-11-25' };
const NO_FILTERS = {
  product: null,
  category: null,
  brand: null,
  state: null,
  method: null,
};

// The payments of 7 October to 25 November, each with when its customer
// first paid for anything.
//   Asha: first paid in September; order A on 15 Oct, B on 3 Nov, C on
//     20 Nov.
//   Meena: first paid on 5 Nov for D, and paid D again on the 6th.
//   Ravi: first paid on 20 Oct for E, then F on 10 Nov.
const pay = (
  day: string,
  userId: string,
  orderId: string,
  firstDay: string,
) => ({
  day,
  userId,
  orderId,
  firstDay,
});
const PAYMENTS = [
  pay('2026-10-15', 'asha', 'A', '2026-09-10'),
  pay('2026-11-03', 'asha', 'B', '2026-09-10'),
  pay('2026-11-20', 'asha', 'C', '2026-09-10'),
  pay('2026-11-05', 'meena', 'D', '2026-11-05'),
  pay('2026-11-06', 'meena', 'D', '2026-11-05'),
  pay('2026-10-20', 'ravi', 'E', '2026-10-20'),
  pay('2026-11-10', 'ravi', 'F', '2026-10-20'),
];
const ACCOUNTS = [
  { day: '2026-10-20', accounts: 1 },
  { day: '2026-11-05', accounts: 2 },
];
const TOP = [
  {
    userId: 'asha',
    name: 'Asha Rao',
    email: 'asha@example.com',
    orders: 2,
    salesRupees: 1284,
  },
];

const sqlOf = (strings: TemplateStringsArray) => strings.join('?');

function setup() {
  const tx = {
    salesSummaryRefresh: {
      findUnique: jest.fn().mockResolvedValue({ refreshedAt: REFRESHED }),
    },
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = sqlOf(strings);
      return Promise.resolve(
        sql.includes('"firsts"')
          ? PAYMENTS
          : sql.includes('"accounts"')
            ? ACCOUNTS
            : TOP,
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
  const reports = new CustomersReportService(
    prisma as unknown as PrismaService,
    sales as unknown as SalesReportService,
  );
  return { reports, prisma, tx, sales };
}

// The values a query was given, by the words in it.
function valuesOf(tx: ReturnType<typeof setup>['tx'], words: string) {
  const call = tx.$queryRaw.mock.calls.find(([strings]) =>
    sqlOf(strings).includes(words),
  ) as [TemplateStringsArray, ...unknown[]] | undefined;
  if (!call) {
    throw new Error(`no query with ${words}`);
  }
  const [strings, ...values] = call;
  return { sql: sqlOf(strings), values };
}

describe('CustomersReportService.customers', () => {
  it('reads in one snapshot, the period and the one of the same length before', async () => {
    const { reports, prisma, sales, tx } = setup();

    const report = await reports.customers(NOVEMBER);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
    expect(report.period).toEqual(NOVEMBER);
    expect(report.previousPeriod).toEqual({
      from: '2026-10-07',
      to: '2026-10-31',
    });
    expect(report.refreshedAt).toBe(REFRESHED);
    expect(report.filters).toBe(NO_FILTERS);
    expect(sales.filtersOf).toHaveBeenCalledWith(tx, null, []);
  });

  it('counts the customers who paid, new or returning, those who paid for more than one order, and the accounts made', async () => {
    const { reports } = setup();

    const report = await reports.customers(NOVEMBER);
    expect(report.totals).toEqual({
      customers: 3,
      // Meena paid for the first time ever in November.
      newCustomers: 1,
      returningCustomers: 2,
      // Asha paid for B and C; Meena's second payment was for D again.
      boughtAgain: 1,
      accountsMade: 2,
    });
    expect(report.previousTotals).toEqual({
      customers: 2,
      // Ravi first paid on 20 October.
      newCustomers: 1,
      returningCustomers: 1,
      boughtAgain: 0,
      accountsMade: 1,
    });
  });

  it('gives each day its customers, beside the same day of the period before', async () => {
    const { reports } = setup();

    const { series } = await reports.customers(NOVEMBER);
    const nothing = {
      customers: 0,
      newCustomers: 0,
      returningCustomers: 0,
      boughtAgain: 0,
      accountsMade: 0,
    };
    expect(series.unit).toBe('day');
    expect(series.points).toHaveLength(25);
    expect(series.points[4]).toEqual({
      start: '2026-11-05',
      customers: 1,
      newCustomers: 1,
      returningCustomers: 0,
      boughtAgain: 0,
      accountsMade: 2,
      previous: nothing,
    });
    // 15 October is 25 days before 9 November, 20 October before the 14th.
    expect(series.points[8]?.previous).toEqual({
      ...nothing,
      customers: 1,
      returningCustomers: 1,
    });
    expect(series.points[13]?.previous).toEqual({
      ...nothing,
      customers: 1,
      newCustomers: 1,
      accountsMade: 1,
    });
  });

  it('counts a customer once a bar, new in the bar of the first payment ever', async () => {
    const { reports } = setup();

    const { series } = await reports.customers({ ...NOVEMBER, unit: 'week' });
    expect(series.unit).toBe('week');
    expect(series.points.map((point) => point.start)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
    ]);
    // Asha on the 3rd, Meena on the 5th and the 6th.
    expect(series.points[1]).toMatchObject({
      customers: 2,
      newCustomers: 1,
      returningCustomers: 1,
      boughtAgain: 0,
      accountsMade: 2,
    });
  });

  it('reads every payment of both periods in India’s days, with each customer’s first', async () => {
    const { reports, tx } = setup();

    await reports.customers(NOVEMBER);
    const { sql, values } = valuesOf(tx, '"firsts"');
    expect(values.slice(0, 4)).toEqual([
      '2026-10-07',
      '2026-11-25',
      // Every product: not cut at the last rebuild.
      false,
      null,
    ]);
    expect(values.slice(-4)).toEqual([null, null, false, null]);
    expect(sql).toContain('min(p."paidAt") AS "first"');
    expect(sql).toContain('(p."paidAt" + INTERVAL \'330 minutes\')::date');
    const accounts = valuesOf(tx, '"accounts"');
    expect(accounts.values).toEqual(['2026-10-07', '2026-11-25']);
    expect(accounts.sql).toContain('u."role" = \'CUSTOMER\'');
  });

  it('narrows to the customers who bought a product, up to the last rebuild, or to a state and a way of paying', async () => {
    const { reports, tx } = setup();

    await reports.customers({
      ...NOVEMBER,
      productId: P1,
      state: 'Kerala',
      method: 'NOT_RECORDED',
    });
    const { values } = valuesOf(tx, '"firsts"');
    expect(values.slice(2, 6)).toEqual([
      true,
      '2026-11-25 06:40:00.000',
      P1,
      P1,
    ]);
    expect(values.slice(-4)).toEqual(['Kerala', 'Kerala', true, null]);
    // The best customers of the same lines and orders.
    const top = valuesOf(tx, '"events"');
    expect(top.values.slice(-5)).toEqual([
      'Kerala',
      'Kerala',
      true,
      null,
      TOP_LIMIT,
    ]);
    expect(top.values).toContain(P1);
  });

  it('names the best customers by their products’ sales without GST, less refunds, up to the last rebuild', async () => {
    const { reports, tx } = setup();

    const report = await reports.customers(NOVEMBER);
    expect(report.topCustomers).toBe(TOP);
    const { sql, values } = valuesOf(tx, '"events"');
    expect(values.slice(0, 6)).toEqual([
      '2026-11-01',
      '2026-11-25',
      '2026-11-25 06:40:00.000',
      '2026-11-01',
      '2026-11-25',
      '2026-11-25 06:40:00.000',
    ]);
    expect(values.at(-1)).toBe(TOP_LIMIT);
    expect(sql).toContain('ON p."razorpayPaymentId" = r."razorpayPaymentId"');
    expect(sql).toContain('(i."lineTotalRupees" - i."gstRupees")');
    expect(sql).toContain('ORDER BY "salesRupees" DESC, u."fullName", u."id"');
  });

  it('names no best customers before the summaries were ever made', async () => {
    const { reports, tx } = setup();
    tx.salesSummaryRefresh.findUnique.mockResolvedValue(null);

    const report = await reports.customers(NOVEMBER);
    expect(report.topCustomers).toEqual([]);
    expect(
      tx.$queryRaw.mock.calls.some(([strings]) =>
        sqlOf(strings).includes('"events"'),
      ),
    ).toBe(false);
  });
});
