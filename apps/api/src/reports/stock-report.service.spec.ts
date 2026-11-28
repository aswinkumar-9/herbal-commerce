import { PrismaService } from '../prisma/prisma.service';
import { SalesReportService } from './sales-report.service';
import { SHELF_LIFE_DAYS, StockReportService } from './stock-report.service';

const P1 = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b41';
// 12:15 on 25 Nov 2026 in India: a batch may be sold today if it expires
// on 25 May 2027 or later.
const NOW = new Date('2026-11-25T06:45:00.000Z');
const NOVEMBER = { from: '2026-11-01', to: '2026-11-25' };
const NO_FILTERS = {
  product: null,
  category: null,
  brand: null,
  state: null,
  method: null,
};

const day = (text: string) => new Date(`${text}T00:00:00.000Z`);
const batch = (id: string, expiresOn: string, quantity: number) => ({
  id,
  batchNumber: id.toUpperCase(),
  expiresOn: day(expiresOn),
  quantity,
});
const variant = (
  id: string,
  name: string,
  changes: Partial<{
    sku: string;
    quantity: number;
    unit: string;
    isActive: boolean;
    lowStockAt: number;
    priceRupees: number;
    live: boolean;
    batches: ReturnType<typeof batch>[];
  }> = {},
) => ({
  id,
  sku: changes.sku ?? id.toUpperCase(),
  quantity: changes.quantity ?? 60,
  unit: changes.unit ?? 'CAPSULES',
  isActive: changes.isActive ?? true,
  lowStockAt: changes.lowStockAt ?? 10,
  priceRupees: changes.priceRupees ?? 449,
  product: { id: `p-${id}`, name, isActive: changes.live ?? true },
  batches: changes.batches ?? [],
});

// The pack sizes, their batches with packs in, the first to expire first.
//   ash: stopped selling on 1 Nov (5 packs), stops on 11 Dec (20), and on
//     1 Mar 2027 (30): sold 50 in November, 2 a day.
//   tulsi: stops today (2 packs), and on 21 Dec (8): sold 3, so low.
//   neem: a draft that never sold, stopping on 23 Feb 2027, 90 days on
//     (3 packs), and on 24 Feb (4).
//   brahmi: on sale, out of stock, more given back than sold.
const VARIANTS = [
  variant('ash', 'Ashwagandha Capsules', {
    batches: [
      batch('b0', '2027-04-30', 5),
      batch('b1', '2027-06-10', 20),
      batch('b2', '2027-08-31', 30),
    ],
  }),
  variant('tulsi', 'Tulsi Tea', {
    quantity: 100,
    unit: 'G',
    priceRupees: 199,
    batches: [batch('b4', '2027-05-24', 2), batch('b3', '2027-06-20', 8)],
  }),
  variant('neem', 'Neem Soap', {
    quantity: 1,
    unit: 'PIECES',
    priceRupees: 99,
    lowStockAt: 0,
    live: false,
    batches: [batch('b5', '2027-08-22', 3), batch('b6', '2027-08-23', 4)],
  }),
  variant('brahmi', 'Brahmi Oil', {
    quantity: 100,
    unit: 'ML',
    priceRupees: 299,
    lowStockAt: 5,
  }),
];
const SOLD = [
  { variantId: 'ash', packs: 50 },
  { variantId: 'tulsi', packs: 3 },
  { variantId: 'brahmi', packs: -1 },
];

function setup() {
  const tx = {
    productVariant: { findMany: jest.fn().mockResolvedValue(VARIANTS) },
    $queryRaw: jest.fn().mockResolvedValue(SOLD),
  };
  const prisma = {
    $transaction: jest.fn(
      (work: (client: typeof tx) => Promise<unknown>, _options: object) =>
        work(tx),
    ),
  };
  const sales = { filtersOf: jest.fn().mockResolvedValue(NO_FILTERS) };
  const reports = new StockReportService(
    prisma as unknown as PrismaService,
    sales as unknown as SalesReportService,
  );
  return { reports, prisma, tx, sales };
}

const valuesOf = (tx: ReturnType<typeof setup>['tx']) =>
  (tx.$queryRaw.mock.calls[0] as unknown[]).slice(1);

describe('StockReportService.stock', () => {
  it('reads live in one snapshot, the sales rate over the period’s days to today', async () => {
    const { reports, prisma, sales, tx } = setup();

    const report = await reports.stock(NOVEMBER, NOW);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
    expect(report.period).toEqual(NOVEMBER);
    expect(report.readAt).toBe(NOW);
    expect(report.rateDays).toBe(25);
    expect(report.filters).toBe(NO_FILTERS);
    expect(sales.filtersOf).toHaveBeenCalledWith(tx, null, []);
    expect(valuesOf(tx)).toEqual([
      '2026-11-01',
      '2026-11-25',
      '2026-11-01',
      '2026-11-25',
    ]);
    // Only the batches with packs in, the first to expire first: the order
    // orders take them in.
    expect(tx.productVariant.findMany.mock.calls[0][0]).toMatchObject({
      where: {},
      select: {
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: [{ expiresOn: 'asc' }, { batchNumber: 'asc' }],
        },
      },
    });
  });

  it('takes the rate only over the days that have come', async () => {
    const { reports, tx } = setup();

    const month = await reports.stock(
      { from: '2026-11-01', to: '2026-11-30' },
      NOW,
    );
    expect(month.rateDays).toBe(25);
    expect(valuesOf(tx)).toEqual([
      '2026-11-01',
      '2026-11-25',
      '2026-11-01',
      '2026-11-25',
    ]);
    expect(month.packSizes[0]?.daysOfCover).toBe(25);
  });

  it('has no rate for a period still to come, and asks for no sales', async () => {
    const { reports, tx } = setup();

    const later = await reports.stock(
      { from: '2026-11-27', to: '2026-11-30' },
      NOW,
    );
    expect(later.rateDays).toBe(0);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(later.packSizes.every((each) => each.daysOfCover === null)).toBe(
      true,
    );
  });

  it('counts the stock of the pack sizes on sale, and the packs too near expiry to sell of any', async () => {
    const { reports } = setup();

    const report = await reports.stock(NOVEMBER, NOW);
    expect(report.totals).toEqual({
      // Not the draft.
      packSizes: 3,
      out: 1,
      low: 1,
      sellablePacks: 58,
      // 50 × ₹449 + 8 × ₹199.
      sellableRupees: 24042,
      // B0, and B4 that stops selling today.
      unsellablePacks: 7,
    });
  });

  it('lists each pack size with its days of cover, the least first, those that did not sell last', async () => {
    const { reports } = setup();

    const report = await reports.stock(NOVEMBER, NOW);
    expect(
      report.packSizes.map((each) => [
        each.productName,
        each.onSale,
        each.sellable,
        each.level,
        each.soldPacks,
        each.daysOfCover,
      ]),
    ).toEqual([
      // 50 packs at 2 a day.
      ['Ashwagandha Capsules', true, 50, 'OK', 50, 25],
      // 8 packs at 3 in 25 days.
      ['Tulsi Tea', true, 8, 'LOW', 3, 66],
      // More given back than sold: no rate.
      ['Brahmi Oil', true, 0, 'OUT', -1, null],
      ['Neem Soap', false, 7, 'OK', 0, null],
    ]);
    expect(report.packSizes[1]).toEqual({
      variantId: 'tulsi',
      productId: 'p-tulsi',
      productName: 'Tulsi Tea',
      sku: 'TULSI',
      quantity: 100,
      unit: 'G',
      onSale: true,
      sellable: 8,
      lowStockAt: 10,
      level: 'LOW',
      soldPacks: 3,
      daysOfCover: 66,
    });
  });

  it(`warns of the batches that stop selling within ${SHELF_LIFE_DAYS} days, or have, and what will be left in them`, async () => {
    const { reports } = setup();

    const report = await reports.stock(NOVEMBER, NOW);
    expect(
      report.shelfLife.map((each) => [
        each.batchNumber,
        each.stopsSellingOn,
        each.daysLeft,
        each.packs,
        each.leftOver,
      ]),
    ).toEqual([
      // Stopped: every pack is left.
      ['B0', '2026-11-01', -24, 5, 5],
      ['B4', '2026-11-25', 0, 2, 2],
      // 16 days at 2 a day sells all 20.
      ['B1', '2026-12-11', 16, 20, 0],
      // 26 days at 0.12 a day sells 3 of 8: B4 sells none of them first.
      ['B3', '2026-12-21', 26, 8, 5],
      // 90 days on, the last day warned of; B6 a day later is not.
      ['B5', '2027-02-23', 90, 3, 3],
    ]);
    expect(report.shelfLife[0]).toEqual({
      batchId: 'b0',
      variantId: 'ash',
      productName: 'Ashwagandha Capsules',
      sku: 'ASH',
      quantity: 60,
      unit: 'CAPSULES',
      batchNumber: 'B0',
      expiresOn: '2027-04-30',
      stopsSellingOn: '2026-11-01',
      packs: 5,
      daysLeft: -24,
      leftOver: 5,
    });
  });

  it('sells the batch that expires first first, so a later one keeps what the earlier ones take', async () => {
    const { reports, tx } = setup();
    tx.productVariant.findMany.mockResolvedValue([
      variant('ash', 'Ashwagandha Capsules', {
        batches: [
          batch('b0', '2027-04-30', 5),
          batch('b1', '2027-06-10', 20),
          batch('b2', '2027-06-20', 20),
        ],
      }),
    ]);
    // 1 a day: 16 days of the first, then 26 days in all. B0 has stopped
    // selling: it takes none of them.
    tx.$queryRaw.mockResolvedValue([{ variantId: 'ash', packs: 25 }]);

    const report = await reports.stock(NOVEMBER, NOW);
    expect(report.shelfLife.map((each) => each.leftOver)).toEqual([5, 4, 14]);
  });

  it('narrows to the pack sizes of a product, a brand, or a category and its subcategories, never by state or way of paying', async () => {
    const { reports, tx, sales } = setup();

    await reports.stock({ ...NOVEMBER, productId: P1 }, NOW);
    await reports.stock({ ...NOVEMBER, brandId: P1, categoryId: P1 }, NOW);
    await reports.stock({ ...NOVEMBER, state: 'Kerala', method: 'UPI' }, NOW);
    const wheres = tx.productVariant.findMany.mock.calls.map(
      ([args]) => (args as { where: unknown }).where,
    );
    expect(wheres).toEqual([
      { productId: P1 },
      {
        product: {
          brandId: P1,
          OR: [{ categoryId: P1 }, { category: { parentId: P1 } }],
        },
      },
      {},
    ]);
    // The page still names what it is narrowed to.
    expect(sales.filtersOf.mock.calls[2]?.[1]).toEqual({
      productId: undefined,
      categoryId: undefined,
      brandId: undefined,
      state: 'Kerala',
      method: 'UPI',
    });
  });
});
