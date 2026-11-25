import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_REGISTER_LINES,
  SalesReportService,
  TOP_LIMIT,
} from './sales-report.service';

const P1 = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b41';
const P2 = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b42';
const WELLNESS = '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a61';
const IMMUNITY = '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a62';
const TEAS = '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a63';
const HIMALAYA = '8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e11';
const REFRESHED = new Date('2026-11-25T06:40:00.000Z');
const day = (text: string) => new Date(`${text}T00:00:00.000Z`);
// One of several IDs, numbered at their end.
const numbered = (start: string, i: number) =>
  `${start}${String(i).padStart(2, '0')}`;

const NONE = {
  soldOrders: 0,
  soldItemsRupees: 0,
  soldGstRupees: 0,
  soldDeliveryRupees: 0,
  refundedOrders: 0,
  refundedItemsRupees: 0,
  refundedGstRupees: 0,
  refundedDeliveryRupees: 0,
};
// 1–25 November: four orders paid, one refunded.
const NOW = {
  soldOrders: 4,
  soldItemsRupees: 2002,
  soldGstRupees: 200,
  soldDeliveryRupees: 98,
  refundedOrders: 1,
  refundedItemsRupees: 449,
  refundedGstRupees: 21,
  refundedDeliveryRupees: 49,
};
// A day's or a place's orders, items' rupees and their GST, sold or
// refunded.
const sold = (orders: number, itemsRupees: number, gstRupees: number) => ({
  ...NONE,
  soldOrders: orders,
  soldItemsRupees: itemsRupees,
  soldGstRupees: gstRupees,
});
const refunded = (orders: number, itemsRupees: number, gstRupees: number) => ({
  ...NONE,
  refundedOrders: orders,
  refundedItemsRupees: itemsRupees,
  refundedGstRupees: gstRupees,
});
const DAYS = [
  { day: day('2026-11-03'), _sum: sold(2, 1000, 100) },
  { day: day('2026-11-20'), _sum: refunded(1, 449, 21) },
];
const PLACES = [
  { deliveryState: 'Karnataka', method: 'UPI', _sum: sold(2, 1000, 100) },
  { deliveryState: 'Karnataka', method: 'CARD', _sum: sold(1, 500, 50) },
  { deliveryState: 'Kerala', method: 'UPI', _sum: sold(1, 300, 30) },
  { deliveryState: 'Kerala', method: null, _sum: refunded(1, 449, 21) },
];
const LINE_NONE = {
  soldPacks: 0,
  soldRupees: 0,
  soldGstRupees: 0,
  refundedPacks: 0,
  refundedRupees: 0,
  refundedGstRupees: 0,
};
const ASHWAGANDHA = {
  productId: P1,
  topCategoryId: WELLNESS,
  topCategoryName: 'Wellness',
  subcategoryId: IMMUNITY,
  subcategoryName: 'Immunity',
  brandId: HIMALAYA,
  brandName: 'Himalaya',
};
const LINES = [
  // Sold 2, one of them refunded; then renamed and sold again.
  {
    ...ASHWAGANDHA,
    productName: 'Ashwagandha Capsules',
    _sum: {
      soldPacks: 2,
      soldRupees: 898,
      soldGstRupees: 43,
      refundedPacks: 1,
      refundedRupees: 449,
      refundedGstRupees: 21,
    },
    _max: { day: day('2026-11-20') },
  },
  {
    ...ASHWAGANDHA,
    productName: 'Ashwagandha Capsules 60',
    _sum: { ...LINE_NONE, soldPacks: 1, soldRupees: 449, soldGstRupees: 21 },
    _max: { day: day('2026-11-24') },
  },
  // In a top category, without a brand.
  {
    productId: P2,
    productName: 'Tulsi Tea',
    topCategoryId: TEAS,
    topCategoryName: 'Herbal Teas',
    subcategoryId: null,
    subcategoryName: null,
    brandId: null,
    brandName: null,
    _sum: { ...LINE_NONE, soldPacks: 3, soldRupees: 597, soldGstRupees: 91 },
    _max: { day: day('2026-11-10') },
  },
  // Sold before part 15C, its pack size deleted since: nothing recorded.
  {
    productId: null,
    productName: 'Gone Soap',
    topCategoryId: null,
    topCategoryName: null,
    subcategoryId: null,
    subcategoryName: null,
    brandId: null,
    brandName: null,
    _sum: { ...LINE_NONE, soldPacks: 1, soldRupees: 199, soldGstRupees: 30 },
    _max: { day: day('2026-11-05') },
  },
];

function setup() {
  const tx = {
    salesSummaryRefresh: {
      findUnique: jest.fn().mockResolvedValue({ refreshedAt: REFRESHED }),
    },
    dailyOrderSale: {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _sum: NOW })
        .mockResolvedValueOnce({ _sum: { ...NONE, soldOrders: null } }),
      groupBy: jest.fn((args: { by: string[] }) =>
        Promise.resolve(args.by.includes('day') ? DAYS : PLACES),
      ),
    },
    dailyLineSale: {
      aggregate: jest.fn(),
      groupBy: jest.fn().mockResolvedValue(LINES),
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ current: true, new: 2, returning: 1 }]),
    product: { findUnique: jest.fn().mockResolvedValue(null) },
    category: { findUnique: jest.fn().mockResolvedValue(null) },
    brand: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    $transaction: jest.fn(
      (work: (client: typeof tx) => Promise<unknown>, _options: object) =>
        work(tx),
    ),
  };
  const reports = new SalesReportService(prisma as unknown as PrismaService);
  return { reports, prisma, tx };
}

const NOVEMBER = { from: '2026-11-01', to: '2026-11-25' };

describe('SalesReportService.sales', () => {
  it('reads in one snapshot, the period and the one of the same length before', async () => {
    const { reports, prisma, tx } = setup();

    const report = await reports.sales(NOVEMBER);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
    expect(report.period).toEqual(NOVEMBER);
    expect(report.previousPeriod).toEqual({
      from: '2026-10-07',
      to: '2026-10-31',
    });
    expect(report.refreshedAt).toBe(REFRESHED);
    expect(report.filters).toEqual({
      product: null,
      category: null,
      brand: null,
    });
    expect(tx.dailyLineSale.aggregate).not.toHaveBeenCalled();
    expect(tx.salesSummaryRefresh.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { refreshedAt: true },
    });
    const [now, before] = tx.dailyOrderSale.aggregate.mock.calls.map(
      ([args]) => (args as { where: object }).where,
    );
    expect(now).toEqual({
      day: { gte: day('2026-11-01'), lte: day('2026-11-25') },
    });
    expect(before).toEqual({
      day: { gte: day('2026-10-07'), lte: day('2026-10-31') },
    });
    for (const [args] of [
      ...tx.dailyOrderSale.groupBy.mock.calls,
      ...tx.dailyLineSale.groupBy.mock.calls,
    ]) {
      expect((args as { where: object }).where).toEqual(now);
    }
  });

  it('counts sales as the products without GST, less refunds, with GST, delivery and what customers paid beside them', async () => {
    const { reports } = setup();

    const { totals } = await reports.sales(NOVEMBER);
    expect(totals).toEqual({
      salesRupees: 1802 - 428,
      gstRupees: 200 - 21,
      deliveryRupees: 98 - 49,
      paidRupees: 1374 + 179 + 49,
      orders: 4,
      // 1802 over 4 orders, to the nearest rupee.
      averageOrderRupees: 451,
      refundedOrders: 1,
      refundedRupees: 449 + 49,
      newCustomers: 2,
      returningCustomers: 1,
    });
  });

  it('gives a period with nothing sold zeros, and no average', async () => {
    const { reports, tx } = setup();
    tx.salesSummaryRefresh.findUnique.mockResolvedValue(null);

    const report = await reports.sales(NOVEMBER);
    expect(report.refreshedAt).toBeNull();
    expect(report.previousTotals).toEqual({
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
    });
  });

  it('counts new and returning customers from the payments, in India’s days, for both periods', async () => {
    const { reports, tx } = setup();
    tx.$queryRaw.mockResolvedValue([
      { current: false, new: 1, returning: 4 },
      { current: true, new: 2, returning: 1 },
    ]);

    const report = await reports.sales(NOVEMBER);
    expect(report.previousTotals).toMatchObject({
      newCustomers: 1,
      returningCustomers: 4,
    });
    expect(report.totals).toMatchObject({
      newCustomers: 2,
      returningCustomers: 1,
    });
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(values.slice(0, 3)).toEqual([
      '2026-10-07',
      '2026-11-01',
      '2026-11-25',
    ]);
    // No filter: every buyer.
    expect(values.slice(3)).toEqual([false, ...Array(8).fill(null)]);
    const sql = strings.join('?');
    expect(sql).toContain('?::date - INTERVAL \'330 minutes\' AS "before"');
    expect(sql).toContain('(?::date + 1) - INTERVAL \'330 minutes\' AS "end"');
    expect(sql).toContain('min(p."paidAt") AS "first"');
  });

  it('gives every day of a short period, a refund taken off its own day', async () => {
    const { reports } = setup();

    const { series } = await reports.sales(NOVEMBER);
    expect(series.unit).toBe('day');
    expect(series.points).toHaveLength(25);
    expect(series.points[0]).toEqual({
      start: '2026-11-01',
      salesRupees: 0,
      orders: 0,
    });
    expect(series.points[2]).toEqual({
      start: '2026-11-03',
      salesRupees: 900,
      orders: 2,
    });
    expect(series.points[19]).toEqual({
      start: '2026-11-20',
      salesRupees: -428,
      orders: 0,
    });
  });

  it('adds a longer period’s days into weeks from Monday, the first from the period’s start', async () => {
    const { reports, tx } = setup();
    // 1 October 2026 is a Thursday, the 4th a Sunday, the 5th a Monday.
    tx.dailyOrderSale.groupBy.mockImplementation((args: { by: string[] }) =>
      Promise.resolve(
        args.by.includes('day')
          ? ['2026-10-01', '2026-10-04', '2026-10-05'].map((text) => ({
              day: day(text),
              _sum: sold(1, 110, 10),
            }))
          : [],
      ),
    );

    const { series } = await reports.sales({
      from: '2026-10-01',
      to: '2026-12-02',
    });
    expect(series.unit).toBe('week');
    expect(series.points).toHaveLength(10);
    expect(series.points.slice(0, 3)).toEqual([
      { start: '2026-10-01', salesRupees: 200, orders: 2 },
      { start: '2026-10-05', salesRupees: 100, orders: 1 },
      { start: '2026-10-12', salesRupees: 0, orders: 0 },
    ]);
  });

  it('ranks the states and the payment methods, each summed over the other', async () => {
    const { reports } = setup();

    const report = await reports.sales(NOVEMBER);
    expect(report.states).toEqual([
      { state: 'Karnataka', salesRupees: 900 + 450, orders: 3 },
      { state: 'Kerala', salesRupees: 270 - 428, orders: 1 },
    ]);
    expect(report.methods).toEqual([
      { method: 'UPI', salesRupees: 900 + 270, orders: 3 },
      { method: 'CARD', salesRupees: 450, orders: 1 },
      { method: null, salesRupees: -428, orders: 0 },
    ]);
  });

  it('ranks the products by their ID, named as they last sold, and keeps an old one by its name', async () => {
    const { reports } = setup();

    const { products } = await reports.sales(NOVEMBER);
    expect(products).toEqual([
      {
        productId: P1,
        name: 'Ashwagandha Capsules 60',
        salesRupees: 855 - 428 + 428,
        packs: 2,
      },
      { productId: P2, name: 'Tulsi Tea', salesRupees: 506, packs: 3 },
      { productId: null, name: 'Gone Soap', salesRupees: 169, packs: 1 },
    ]);
  });

  it('keeps two old products without an ID apart, by their names', async () => {
    const { reports, tx } = setup();
    const old = LINES[3];
    tx.dailyLineSale.groupBy.mockResolvedValue([
      old,
      { ...old, productName: 'Gone Oil' },
    ]);

    const { products } = await reports.sales(NOVEMBER);
    expect(products.map((product) => product.name)).toEqual([
      'Gone Oil',
      'Gone Soap',
    ]);
  });

  it('ranks the top categories with their subcategories, and the brands, telling no brand from not recorded', async () => {
    const { reports } = setup();

    const report = await reports.sales(NOVEMBER);
    expect(report.categories).toEqual([
      {
        categoryId: WELLNESS,
        name: 'Wellness',
        salesRupees: 855,
        subcategories: [
          { categoryId: IMMUNITY, name: 'Immunity', salesRupees: 855 },
        ],
      },
      {
        categoryId: TEAS,
        name: 'Herbal Teas',
        salesRupees: 506,
        subcategories: [],
      },
      { categoryId: null, name: null, salesRupees: 169, subcategories: [] },
    ]);
    expect(report.brands).toEqual([
      { brandId: HIMALAYA, name: 'Himalaya', recorded: true, salesRupees: 855 },
      { brandId: null, name: null, recorded: true, salesRupees: 506 },
      { brandId: null, name: null, recorded: false, salesRupees: 169 },
    ]);
  });

  it(`lists only the best ${TOP_LIMIT} products and brands, equal ones by name`, async () => {
    const { reports, tx } = setup();
    tx.dailyLineSale.groupBy.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        ...ASHWAGANDHA,
        productId: numbered('7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b', i),
        productName: `Product ${String.fromCharCode(76 - i)}`,
        brandId: numbered('8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e', i),
        brandName: `Brand ${String.fromCharCode(76 - i)}`,
        _sum: { ...LINE_NONE, soldRupees: i < 2 ? 100 : 100 + i },
        _max: { day: day('2026-11-02') },
      })),
    );

    const report = await reports.sales(NOVEMBER);
    expect(report.products.map((product) => product.name)).toEqual([
      'Product A',
      'Product B',
      'Product C',
      'Product D',
      'Product E',
      'Product F',
      'Product G',
      'Product H',
      'Product I',
      'Product J',
    ]);
    expect(report.brands).toHaveLength(TOP_LIMIT);
    // The last two sold 100 each: by name, K before L.
    tx.dailyLineSale.groupBy.mockResolvedValue(
      ['L', 'K'].map((letter, i) => ({
        ...ASHWAGANDHA,
        productId: `7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b9${i}`,
        productName: `Product ${letter}`,
        _sum: { ...LINE_NONE, soldRupees: 100 },
        _max: { day: day('2026-11-02') },
      })),
    );
    tx.dailyOrderSale.aggregate.mockResolvedValue({ _sum: NONE });
    const ties = await reports.sales(NOVEMBER);
    expect(ties.products.map((product) => product.name)).toEqual([
      'Product K',
      'Product L',
    ]);
  });

  it('puts what was not recorded after an equal one with a name', async () => {
    const { reports, tx } = setup();
    tx.dailyOrderSale.groupBy.mockImplementation((args: { by: string[] }) =>
      Promise.resolve(
        args.by.includes('day')
          ? []
          : [null, 'CARD'].map((method) => ({
              deliveryState: 'Goa',
              method,
              _sum: sold(1, 110, 10),
            })),
      ),
    );

    const { methods } = await reports.sales(NOVEMBER);
    expect(methods.map((entry) => entry.method)).toEqual(['CARD', null]);
  });
});

// Ashwagandha's lines in November: 2 packs on the 3rd, one of them refunded
// on the 20th, and one more on the 24th; one pack in October.
const ASH_NOW = {
  soldPacks: 3,
  soldRupees: 1347,
  soldGstRupees: 64,
  refundedPacks: 1,
  refundedRupees: 449,
  refundedGstRupees: 21,
};
const ASH_BEFORE = {
  ...LINE_NONE,
  soldPacks: 1,
  soldRupees: 449,
  soldGstRupees: 21,
};
const ASH_DAYS = [
  {
    day: day('2026-11-03'),
    _sum: { ...LINE_NONE, soldPacks: 2, soldRupees: 898, soldGstRupees: 43 },
  },
  {
    day: day('2026-11-20'),
    _sum: {
      ...LINE_NONE,
      refundedPacks: 1,
      refundedRupees: 449,
      refundedGstRupees: 21,
    },
  },
  {
    day: day('2026-11-24'),
    _sum: { ...LINE_NONE, soldPacks: 1, soldRupees: 449, soldGstRupees: 21 },
  },
];
const ASH_PLACES = [
  {
    deliveryState: 'Karnataka',
    method: 'UPI',
    _sum: {
      soldPacks: 2,
      soldRupees: 898,
      soldGstRupees: 43,
      refundedPacks: 1,
      refundedRupees: 449,
      refundedGstRupees: 21,
    },
  },
  {
    deliveryState: 'Kerala',
    method: 'CARD',
    _sum: { ...LINE_NONE, soldPacks: 1, soldRupees: 449, soldGstRupees: 21 },
  },
];
// The orders with Ashwagandha in, paid or refunded, by day and place: two
// periods' worth.
const ASH_ORDERS = [
  {
    day: '2026-10-15',
    state: 'Kerala',
    method: 'UPI',
    refunded: false,
    orders: 1,
  },
  {
    day: '2026-10-20',
    state: 'Kerala',
    method: 'UPI',
    refunded: true,
    orders: 1,
  },
  {
    day: '2026-11-03',
    state: 'Karnataka',
    method: 'UPI',
    refunded: false,
    orders: 2,
  },
  {
    day: '2026-11-20',
    state: 'Karnataka',
    method: 'UPI',
    refunded: true,
    orders: 1,
  },
  {
    day: '2026-11-24',
    state: 'Kerala',
    method: 'CARD',
    refunded: false,
    orders: 1,
  },
];

function filtered() {
  const made = setup();
  const { tx } = made;
  tx.dailyLineSale.aggregate
    .mockResolvedValueOnce({ _sum: ASH_NOW })
    .mockResolvedValueOnce({ _sum: ASH_BEFORE });
  tx.dailyLineSale.groupBy.mockImplementation((args: { by: string[] }) =>
    Promise.resolve(
      args.by.includes('day')
        ? ASH_DAYS
        : args.by.includes('deliveryState')
          ? ASH_PLACES
          : LINES.slice(0, 2),
    ),
  );
  // The customers' query, then the orders'.
  tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
    Promise.resolve(
      strings.join('?').includes('"firsts"')
        ? [
            { current: true, new: 1, returning: 1 },
            { current: false, new: 1, returning: 0 },
          ]
        : ASH_ORDERS,
    ),
  );
  return made;
}

const queryOf = (tx: ReturnType<typeof setup>['tx'], i: number) => {
  const [strings, ...values] = tx.$queryRaw.mock.calls[i] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return { sql: strings.join('?'), values };
};

describe('SalesReportService.sales, narrowed to some products', () => {
  it('counts only their lines: without GST, less refunds, with their GST and no delivery', async () => {
    const { reports, tx } = filtered();

    const report = await reports.sales({ ...NOVEMBER, productId: P1 });
    expect(report.totals).toEqual({
      salesRupees: 1347 - 64 - (449 - 21),
      gstRupees: 64 - 21,
      deliveryRupees: null,
      paidRupees: 855 + 43,
      // The orders with it in, paid in the period, and refunded in it.
      orders: 3,
      // Its 1283 before refunds over 3 orders, to the nearest rupee.
      averageOrderRupees: 428,
      refundedOrders: 1,
      refundedRupees: 449,
      newCustomers: 1,
      returningCustomers: 1,
    });
    expect(report.previousTotals).toEqual({
      salesRupees: 428,
      gstRupees: 21,
      deliveryRupees: null,
      paidRupees: 449,
      orders: 1,
      averageOrderRupees: 428,
      refundedOrders: 1,
      refundedRupees: 0,
      newCustomers: 1,
      returningCustomers: 0,
    });
    // Whole orders' summaries say nothing of one product.
    expect(tx.dailyOrderSale.aggregate).not.toHaveBeenCalled();
    expect(tx.dailyOrderSale.groupBy).not.toHaveBeenCalled();
  });

  it('reads their lines only, a category with its subcategories, a brand, or those together', async () => {
    const inNovember = {
      day: { gte: day('2026-11-01'), lte: day('2026-11-25') },
    };
    const { reports, tx } = filtered();
    await reports.sales({ ...NOVEMBER, productId: P1 });
    expect(tx.dailyLineSale.aggregate.mock.calls.map(([args]) => args)).toEqual(
      [
        { where: { ...inNovember, productId: P1 }, _sum: expect.any(Object) },
        {
          where: {
            day: { gte: day('2026-10-07'), lte: day('2026-10-31') },
            productId: P1,
          },
          _sum: expect.any(Object),
        },
      ],
    );
    for (const [args] of tx.dailyLineSale.groupBy.mock.calls) {
      expect((args as { where: object }).where).toEqual({
        ...inNovember,
        productId: P1,
      });
    }

    const second = filtered();
    await second.reports.sales({
      ...NOVEMBER,
      categoryId: WELLNESS,
      brandId: HIMALAYA,
    });
    expect(second.tx.dailyLineSale.groupBy.mock.calls[0][0]).toMatchObject({
      where: {
        ...inNovember,
        brandId: HIMALAYA,
        OR: [{ topCategoryId: WELLNESS }, { subcategoryId: WELLNESS }],
      },
    });
  });

  it('counts the orders with them in from the payments and refunds, in India’s days, up to the last rebuild', async () => {
    const { reports, tx } = filtered();

    await reports.sales({ ...NOVEMBER, categoryId: WELLNESS });
    const { sql, values } = queryOf(tx, 1);
    expect(values).toEqual([
      '2026-10-07',
      '2026-11-25',
      '2026-11-25 06:40:00.000',
      '2026-10-07',
      '2026-11-25',
      '2026-11-25 06:40:00.000',
      null,
      null,
      WELLNESS,
      WELLNESS,
      WELLNESS,
      null,
      null,
    ]);
    expect(sql).toContain('p."paidAt" < ?::timestamp');
    expect(sql).toContain('r."createdAt" < ?::timestamp');
    expect(sql).toContain('(p."paidAt" + INTERVAL \'330 minutes\')::date');
    expect(sql).toContain('ON p."razorpayPaymentId" = r."razorpayPaymentId"');
    expect(sql).toContain('i."topCategoryId" = ?::uuid');
    expect(sql).toContain('i."subcategoryId" = ?::uuid');
  });

  it('counts customers who bought them, up to the last rebuild', async () => {
    const { reports, tx } = filtered();

    await reports.sales({ ...NOVEMBER, brandId: HIMALAYA });
    const { sql, values } = queryOf(tx, 0);
    expect(values).toEqual([
      '2026-10-07',
      '2026-11-01',
      '2026-11-25',
      true,
      '2026-11-25 06:40:00.000',
      null,
      null,
      null,
      null,
      null,
      HIMALAYA,
      HIMALAYA,
    ]);
    expect(sql).toContain('i."brandId" = ?::uuid');
  });

  it('counts no orders before the summaries were ever made', async () => {
    const { reports, tx } = filtered();
    tx.salesSummaryRefresh.findUnique.mockResolvedValue(null);

    const report = await reports.sales({ ...NOVEMBER, productId: P1 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(queryOf(tx, 0).values[4]).toBeNull();
    expect(report.totals.orders).toBe(0);
    expect(report.totals.averageOrderRupees).toBeNull();
  });

  it('keeps a state paid for in two ways apart in each', async () => {
    const { reports, tx } = filtered();
    tx.dailyLineSale.groupBy.mockImplementation((args: { by: string[] }) =>
      Promise.resolve(
        args.by.includes('deliveryState')
          ? ['UPI', 'CARD'].map((method) => ({
              deliveryState: 'Goa',
              method,
              _sum: { ...LINE_NONE, soldRupees: 449, soldGstRupees: 21 },
            }))
          : [],
      ),
    );
    tx.$queryRaw.mockResolvedValue([]);

    const report = await reports.sales({ ...NOVEMBER, productId: P1 });
    expect(report.states).toEqual([
      { state: 'Goa', salesRupees: 856, orders: 0 },
    ]);
    expect(report.methods).toEqual([
      { method: 'CARD', salesRupees: 428, orders: 0 },
      { method: 'UPI', salesRupees: 428, orders: 0 },
    ]);
  });

  it('gives each day, state and method their sales and the orders with them in', async () => {
    const { reports } = filtered();

    const report = await reports.sales({ ...NOVEMBER, productId: P1 });
    const points = report.series.points.filter(
      (point) => point.salesRupees !== 0 || point.orders !== 0,
    );
    expect(points).toEqual([
      { start: '2026-11-03', salesRupees: 855, orders: 2 },
      { start: '2026-11-20', salesRupees: -428, orders: 0 },
      { start: '2026-11-24', salesRupees: 428, orders: 1 },
    ]);
    expect(report.states).toEqual([
      { state: 'Kerala', salesRupees: 428, orders: 1 },
      { state: 'Karnataka', salesRupees: 427, orders: 2 },
    ]);
    expect(report.methods).toEqual([
      { method: 'CARD', salesRupees: 428, orders: 1 },
      { method: 'UPI', salesRupees: 427, orders: 2 },
    ]);
    expect(report.products.map((product) => product.name)).toEqual([
      'Ashwagandha Capsules 60',
    ]);
  });

  it('names the filters as the catalog does now', async () => {
    const { reports, tx } = filtered();
    tx.product.findUnique.mockResolvedValue({ name: 'Ashwagandha 60s' });
    tx.category.findUnique.mockResolvedValue({
      name: 'Immunity',
      parent: { name: 'Wellness' },
    });
    tx.brand.findUnique.mockResolvedValue({ name: 'Himalaya Wellness' });

    const { filters } = await reports.sales({
      ...NOVEMBER,
      productId: P1,
      categoryId: IMMUNITY,
      brandId: HIMALAYA,
    });
    expect(filters).toEqual({
      product: { productId: P1, name: 'Ashwagandha 60s' },
      category: {
        categoryId: IMMUNITY,
        name: 'Immunity',
        parentName: 'Wellness',
      },
      brand: { brandId: HIMALAYA, name: 'Himalaya Wellness' },
    });
    expect(tx.category.findUnique).toHaveBeenCalledWith({
      where: { id: IMMUNITY },
      select: { name: true, parent: { select: { name: true } } },
    });
  });

  it('names one gone from the catalog as it last sold, and a top category without a parent', async () => {
    const { reports } = filtered();

    const gone = await reports.sales({
      ...NOVEMBER,
      productId: P1,
      categoryId: IMMUNITY,
      brandId: HIMALAYA,
    });
    expect(gone.filters.product).toEqual({
      productId: P1,
      name: 'Ashwagandha Capsules 60',
    });
    expect(gone.filters.brand).toEqual({ brandId: HIMALAYA, name: 'Himalaya' });

    const second = filtered();
    const subcategory = await second.reports.sales({
      ...NOVEMBER,
      categoryId: IMMUNITY,
    });
    expect(subcategory.filters.category).toEqual({
      categoryId: IMMUNITY,
      name: 'Immunity',
      parentName: 'Wellness',
    });

    const third = filtered();
    third.tx.category.findUnique.mockResolvedValue({
      name: 'Wellness',
      parent: null,
    });
    const top = await third.reports.sales({
      ...NOVEMBER,
      categoryId: WELLNESS,
    });
    expect(top.filters.category).toEqual({
      categoryId: WELLNESS,
      name: 'Wellness',
      parentName: null,
    });
  });
});

// The register's rows as the database gives them: order B paid with two
// lines and a delivery charge, then refunded; order J paid, one line.
const registerRow = (fields: object) => ({
  at: '2026-11-20 00:00:00',
  sortAt: new Date('2026-11-19T18:30:00.000Z'),
  refunded: false,
  reference: 'BBBBBBBBBB',
  state: 'Kerala',
  method: 'CARD',
  deliveryRupees: 49,
  position: 0,
  productName: 'Ashwagandha Capsules',
  sku: 'ASH-60',
  topCategoryName: 'Wellness',
  subcategoryName: 'Immunity',
  brandName: 'Himalaya',
  gstRate: 5,
  packs: 1,
  lineTotalRupees: 449,
  gstRupees: 21,
  ...fields,
});
const B_SOLD = [
  registerRow({}),
  registerRow({
    position: 1,
    productName: 'Tulsi Tea',
    sku: 'TUL-100',
    gstRate: 18,
    packs: 2,
    lineTotalRupees: 398,
    gstRupees: 61,
  }),
];
const J_SOLD = registerRow({
  reference: 'JJJJJJJJJJ',
  state: 'Goa',
  method: 'UPI',
  deliveryRupees: 0,
});
const B_REFUNDED = registerRow({
  at: '2026-11-21 00:30:00',
  sortAt: new Date('2026-11-20T19:00:00.000Z'),
  refunded: true,
});

function exporting(registerRows: object[]) {
  const made = setup();
  made.tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    return Promise.resolve(
      sql.includes('"lineTotalRupees"')
        ? registerRows
        : sql.includes('"firsts"')
          ? [{ current: true, new: 2, returning: 1 }]
          : [],
    );
  });
  return made;
}

describe('SalesReportService.forExport', () => {
  it('lists every product and brand, and gives every day of the period its figures', async () => {
    const { reports, tx } = exporting([]);
    const many = Array.from({ length: TOP_LIMIT + 2 }, (_, i) => ({
      ...LINES[2],
      productId: numbered(P2.slice(0, -2), i),
      productName: `Product ${i}`,
      brandId: numbered(HIMALAYA.slice(0, -2), i),
      brandName: `Brand ${i}`,
    }));
    tx.dailyLineSale.groupBy.mockResolvedValue(many);

    const found = await reports.forExport(NOVEMBER);
    expect(found?.report.products).toHaveLength(TOP_LIMIT + 2);
    expect(found?.report.brands).toHaveLength(TOP_LIMIT + 2);
    expect(found?.days).toHaveLength(25);
    expect(found?.days[0]).toEqual({
      day: '2026-11-01',
      salesRupees: 0,
      gstRupees: 0,
      deliveryRupees: 0,
      paidRupees: 0,
      orders: 0,
      refundedOrders: 0,
      refundedRupees: 0,
    });
    // The 3rd: 2 orders, 1000 with 100 of GST.
    expect(found?.days[2]).toEqual({
      day: '2026-11-03',
      salesRupees: 900,
      gstRupees: 100,
      deliveryRupees: 0,
      paidRupees: 1000,
      orders: 2,
      refundedOrders: 0,
      refundedRupees: 0,
    });
    expect(found?.days[19]).toMatchObject({
      day: '2026-11-20',
      salesRupees: -428,
      refundedOrders: 1,
      refundedRupees: 449,
    });
  });

  it('gives each grouping in full beside the period before, from the same summaries', async () => {
    const { reports, tx } = exporting([]);

    const found = await reports.forExport(NOVEMBER);
    // The summaries give the same rows for both periods here.
    expect(found?.detail.products[0]).toEqual({
      productId: P1,
      name: 'Ashwagandha Capsules 60',
      categoryName: 'Wellness',
      subcategoryName: 'Immunity',
      brandName: 'Himalaya',
      recorded: true,
      soldPacks: 3,
      refundedPacks: 1,
      grossRupees: 1283,
      refundRupees: 428,
      salesRupees: 855,
      gstRupees: 43,
      previousSalesRupees: 855,
    });
    // Each state's orders as the report counts them.
    expect(
      found?.detail.states.map((state) => [
        state.state,
        state.orders,
        state.salesRupees,
        state.deliveryRupees,
        state.previousSalesRupees,
      ]),
    ).toEqual([
      ['Karnataka', 3, 1350, 0, 1350],
      ['Kerala', 1, -158, 0, -158],
    ]);
    const before = { day: { gte: day('2026-10-07'), lte: day('2026-10-31') } };
    expect(tx.dailyLineSale.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: expect.arrayContaining(['productId', 'brandName']),
        where: before,
      }),
    );
    expect(tx.dailyOrderSale.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['deliveryState', 'method'],
        where: before,
      }),
    );
  });

  it('gives each state and method of a narrowed file only the filter’s lines, without delivery', async () => {
    const { reports, tx } = exporting([]);
    tx.dailyLineSale.aggregate.mockResolvedValue({ _sum: LINE_NONE });
    tx.dailyLineSale.groupBy.mockImplementation((args: { by: string[] }) =>
      Promise.resolve(
        args.by.includes('day')
          ? []
          : args.by.includes('deliveryState')
            ? [
                {
                  deliveryState: 'Kerala',
                  method: 'UPI',
                  _sum: {
                    ...LINE_NONE,
                    soldPacks: 1,
                    soldRupees: 449,
                    soldGstRupees: 21,
                  },
                },
              ]
            : LINES,
      ),
    );

    const found = await reports.forExport({ ...NOVEMBER, productId: P1 });
    expect(found?.detail.states).toEqual([
      expect.objectContaining({
        state: 'Kerala',
        salesRupees: 428,
        gstRupees: 21,
        deliveryRupees: null,
        paidRupees: 449,
        previousSalesRupees: 428,
      }),
    ]);
    expect(tx.dailyLineSale.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['deliveryState', 'method'],
        where: {
          day: { gte: day('2026-10-07'), lte: day('2026-10-31') },
          productId: P1,
        },
      }),
    );
    // Each product of the filter only, in both periods.
    expect(tx.dailyLineSale.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: expect.arrayContaining(['productId', 'brandName']),
        where: {
          day: { gte: day('2026-10-07'), lte: day('2026-10-31') },
          productId: P1,
        },
      }),
    );
    expect(tx.dailyOrderSale.groupBy).not.toHaveBeenCalled();
  });

  it('registers each line, a refund below 0, and each order’s delivery after its last line', async () => {
    const { reports, tx } = exporting([...B_SOLD, J_SOLD, B_REFUNDED]);

    const found = await reports.forExport(NOVEMBER);
    expect(
      found?.register.map((line) => [
        line.kind,
        line.reference,
        line.product?.name ?? 'delivery',
        line.packs,
        line.priceRupees,
        line.gstRupees,
        line.totalRupees,
      ]),
    ).toEqual([
      ['SALE', 'BBBBBBBBBB', 'Ashwagandha Capsules', 1, 428, 21, 449],
      ['SALE', 'BBBBBBBBBB', 'Tulsi Tea', 2, 337, 61, 398],
      ['SALE', 'BBBBBBBBBB', 'delivery', 0, 49, 0, 49],
      // J has no delivery charge: no line for it.
      ['SALE', 'JJJJJJJJJJ', 'Ashwagandha Capsules', 1, 428, 21, 449],
      ['REFUND', 'BBBBBBBBBB', 'Ashwagandha Capsules', -1, -428, -21, -449],
      ['REFUND', 'BBBBBBBBBB', 'delivery', 0, -49, 0, -49],
    ]);
    expect(found?.register[0]).toMatchObject({
      at: '2026-11-20 00:00:00',
      state: 'Kerala',
      method: 'CARD',
      product: {
        sku: 'ASH-60',
        categoryName: 'Wellness',
        subcategoryName: 'Immunity',
        brandName: 'Himalaya',
        gstRate: 5,
      },
    });

    const register = tx.$queryRaw.mock.calls.find(([strings]) =>
      (strings as TemplateStringsArray).join('?').includes('"lineTotalRupees"'),
    ) as [TemplateStringsArray, ...unknown[]];
    const [strings, ...values] = register;
    expect(values).toEqual([
      '2026-11-01',
      '2026-11-25',
      '2026-11-25 06:40:00.000',
      '2026-11-01',
      '2026-11-25',
      '2026-11-25 06:40:00.000',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      MAX_REGISTER_LINES + 1,
    ]);
    const sql = strings.join('?');
    expect(sql).toContain('ON p."razorpayPaymentId" = r."razorpayPaymentId"');
    expect(sql).toContain(
      'ORDER BY e."at", o."reference", e."refunded", i."position"',
    );
  });

  it('gives an order paid and refunded at the same moment a delivery line for each', async () => {
    const { reports } = exporting([
      registerRow({}),
      registerRow({ refunded: true }),
    ]);

    const found = await reports.forExport(NOVEMBER);
    expect(
      found?.register.map((line) => [
        line.kind,
        line.product ? 'line' : 'delivery',
      ]),
    ).toEqual([
      ['SALE', 'line'],
      ['SALE', 'delivery'],
      ['REFUND', 'line'],
      ['REFUND', 'delivery'],
    ]);
  });

  it('keeps delivery out of a narrowed register, and asks for the filter’s lines only', async () => {
    const { reports, tx } = exporting([...B_SOLD, B_REFUNDED]);
    tx.dailyLineSale.aggregate.mockResolvedValue({ _sum: LINE_NONE });
    tx.dailyLineSale.groupBy.mockImplementation((args: { by: string[] }) =>
      Promise.resolve(
        args.by.includes('day') || args.by.includes('deliveryState')
          ? []
          : LINES,
      ),
    );

    const found = await reports.forExport({ ...NOVEMBER, productId: P1 });
    expect(found?.register.map((line) => line.product?.name)).toEqual([
      'Ashwagandha Capsules',
      'Tulsi Tea',
      'Ashwagandha Capsules',
    ]);
    // Each day narrowed: no delivery.
    expect(found?.days[0]?.deliveryRupees).toBeNull();
    const register = tx.$queryRaw.mock.calls.find(([strings]) =>
      (strings as TemplateStringsArray).join('?').includes('"lineTotalRupees"'),
    ) as [TemplateStringsArray, ...unknown[]];
    expect(register.slice(7, 9)).toEqual([P1, P1]);
  });

  it('gives nothing to register before the summaries were ever made, and refuses one too long', async () => {
    const empty = exporting([J_SOLD]);
    empty.tx.salesSummaryRefresh.findUnique.mockResolvedValue(null);
    expect((await empty.reports.forExport(NOVEMBER))?.register).toEqual([]);
    expect(
      empty.tx.$queryRaw.mock.calls.some(([strings]) =>
        (strings as TemplateStringsArray)
          .join('?')
          .includes('"lineTotalRupees"'),
      ),
    ).toBe(false);

    const long = exporting(
      Array.from({ length: MAX_REGISTER_LINES + 1 }, () => J_SOLD),
    );
    await expect(long.reports.forExport(NOVEMBER)).resolves.toBeNull();
    const fits = exporting(
      Array.from({ length: MAX_REGISTER_LINES }, () => J_SOLD),
    );
    await expect(fits.reports.forExport(NOVEMBER)).resolves.not.toBeNull();
  });
});
