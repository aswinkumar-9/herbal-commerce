import { PrismaService } from '../prisma/prisma.service';
import { SalesReportService, TOP_LIMIT } from './sales-report.service';

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
    dailyLineSale: { groupBy: jest.fn().mockResolvedValue(LINES) },
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ current: true, new: 2, returning: 1 }]),
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
    expect(values).toEqual(['2026-10-07', '2026-11-01', '2026-11-25']);
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
