import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { asTyped, START_AGAIN, StockOverviewService } from './stock-overview.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
// 6 November 2026, 10:00 in India: batches expiring from 6 May 2027 sell.
const NOW = new Date('2026-11-06T04:30:00.000Z');
const PRODUCT = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';

// A pack size as the query returns it, with its batches.
function pack(id: string, batches: { id: string; expiresOn: string; quantity: number }[], changes: object = {}) {
  return {
    id,
    sku: `SKU-${id}`,
    quantity: 60,
    unit: 'CAPSULES',
    isActive: true,
    lowStockAt: 10,
    position: 0,
    product: { id: PRODUCT, name: 'Ashwagandha Capsules', isActive: true },
    batches: batches.map((batch) => ({ ...batch, expiresOn: day(batch.expiresOn) })),
    ...changes,
  };
}

// Plenty, low (5), out (nothing that sells) and plenty with a batch that
// stops selling on 6 December 2026, in 30 days.
const PACKS = [
  pack('v-ok', [{ id: 'b-1', expiresOn: '2028-09-30', quantity: 50 }]),
  pack('v-low', [{ id: 'b-2', expiresOn: '2028-09-30', quantity: 5 }]),
  pack('v-out', [{ id: 'b-3', expiresOn: '2027-05-05', quantity: 9 }]),
  pack('v-soon', [
    { id: 'b-4', expiresOn: '2027-06-05', quantity: 20 },
    { id: 'b-5', expiresOn: '2028-09-30', quantity: 30 },
  ]),
];

function setup(packs: object[] = PACKS) {
  const prisma = {
    productVariant: { findMany: jest.fn().mockResolvedValue(packs) },
    stockMovement: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const service = new StockOverviewService(prisma as unknown as PrismaService);
  return { service, prisma };
}

const ids = (result: { lines: { variant: { id: string } }[] }) =>
  result.lines.map((line) => line.variant.id);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('StockOverviewService.list', () => {
  it('lists every pack size with its stock, by product name, then in the product’s order', async () => {
    const { service, prisma } = setup();

    const result = await service.list({ limit: 100 });

    expect(ids(result)).toEqual(['v-ok', 'v-low', 'v-out', 'v-soon']);
    expect(result.nextAfter).toBeNull();
    expect(result.lines[1]).toEqual({
      variant: {
        id: 'v-low',
        sku: 'SKU-v-low',
        quantity: 60,
        unit: 'CAPSULES',
        isActive: true,
        lowStockAt: 10,
        position: 0,
      },
      product: { id: PRODUCT, name: 'Ashwagandha Capsules', isActive: true },
      stock: {
        free: 5,
        sellable: 5,
        awaitingPacking: 0,
        packed: 0,
        level: 'LOW',
        stopsSellingOn: '2028-04-01',
        expiringSoon: false,
      },
    });
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [
        { product: { name: 'asc' } },
        { productId: 'asc' },
        { position: 'asc' },
        { id: 'asc' },
      ],
      select: expect.objectContaining({
        lowStockAt: true,
        product: { select: { id: true, name: true, isActive: true } },
        batches: { select: { id: true, expiresOn: true, quantity: true } },
      }),
    });
  });

  it('filters: out of stock, low or out, and a batch that stops selling soon', async () => {
    const { service } = setup();

    expect(ids(await service.list({ limit: 100, status: 'out' }))).toEqual(['v-out']);
    expect(ids(await service.list({ limit: 100, status: 'low' }))).toEqual(['v-low', 'v-out']);
    expect(ids(await service.list({ limit: 100, status: 'expiring' }))).toEqual(['v-soon']);
  });

  it("counts a pack size as low at its own number of packs", async () => {
    const { service } = setup([
      pack('v-big', [{ id: 'b-1', expiresOn: '2028-09-30', quantity: 50 }], { lowStockAt: 60 }),
      pack('v-never', [{ id: 'b-2', expiresOn: '2028-09-30', quantity: 2 }], { lowStockAt: 0 }),
    ]);

    const result = await service.list({ limit: 100 });

    expect(result.lines.map((line) => line.stock.level)).toEqual(['LOW', 'OK']);
    expect(ids(await service.list({ limit: 100, status: 'low' }))).toEqual(['v-big']);
  });

  it("asks for one product's pack sizes, or words in the product's name or the SKU", async () => {
    const { service, prisma } = setup();

    await service.list({ limit: 100, productId: PRODUCT });
    expect(prisma.productVariant.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { productId: PRODUCT } }),
    );
    await service.list({ limit: 100, productId: PRODUCT, q: 'ashwa' });
    expect(prisma.productVariant.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          productId: PRODUCT,
          OR: [
            { sku: { contains: 'ashwa', mode: 'insensitive' } },
            { product: { name: { contains: 'ashwa', mode: 'insensitive' } } },
          ],
        },
      }),
    );
  });

  it('looks for % and _ as they are typed, not as wildcards', async () => {
    const { service, prisma } = setup();

    await service.list({ limit: 100, q: '100%_\\x' });
    expect(prisma.productVariant.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { sku: { contains: '100\\%\\_\\\\x', mode: 'insensitive' } },
            { product: { name: { contains: '100\\%\\_\\\\x', mode: 'insensitive' } } },
          ],
        },
      }),
    );
    expect(asTyped('ashwa cap')).toBe('ashwa cap');
  });

  it('counts what orders hold, from all the batches at once', async () => {
    const { service, prisma } = setup();
    prisma.stockMovement.groupBy
      .mockResolvedValueOnce([{ batchId: 'b-2', _sum: { change: -2 } }])
      .mockResolvedValueOnce([{ batchId: 'b-2', _sum: { change: -1 } }]);

    const result = await service.list({ limit: 100 });

    expect(result.lines[1].stock).toMatchObject({ awaitingPacking: 2, packed: 1 });
    expect(prisma.stockMovement.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.stockMovement.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ batchId: { in: ['b-1', 'b-2', 'b-3', 'b-4', 'b-5'] } }),
      }),
    );
  });

  it('pages: the next page starts after the last pack size shown, and the last page says so', async () => {
    const { service } = setup();

    const first = await service.list({ limit: 2 });
    expect([ids(first), first.nextAfter]).toEqual([['v-ok', 'v-low'], 'v-low']);
    const second = await service.list({ limit: 2, after: 'v-low' });
    expect([ids(second), second.nextAfter]).toEqual([['v-out', 'v-soon'], null]);
    // Exactly a page left: no empty page after it.
    const exact = await service.list({ limit: 4 });
    expect(exact.nextAfter).toBeNull();
  });

  it('pages a filtered list too, after a pack size that may no longer match', async () => {
    const { service } = setup();

    const first = await service.list({ limit: 1, status: 'low' });
    expect([ids(first), first.nextAfter]).toEqual([['v-low'], 'v-low']);
    // v-ok was enough: the page still goes on after it.
    const later = await service.list({ limit: 1, status: 'low', after: 'v-ok' });
    expect(ids(later)).toEqual(['v-low']);
  });

  it('asks staff to start again after a pack size that is gone', async () => {
    const { service } = setup();

    const error: unknown = await service.list({ limit: 2, after: 'v-gone' }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      message: 'Validation failed',
      errors: [{ field: 'after', message: START_AGAIN }],
    });
  });

  it('lists a pack size without batches as out of stock, and asks nothing about orders when no batch exists', async () => {
    const { service, prisma } = setup([pack('v-new', [])]);

    const result = await service.list({ limit: 100 });

    expect(result.lines[0].stock).toMatchObject({ free: 0, level: 'OUT' });
    expect(prisma.stockMovement.groupBy).not.toHaveBeenCalled();
  });
});
