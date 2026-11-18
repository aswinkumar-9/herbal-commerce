import { holdsOf, NO_HOLDS, stockLine, summarise } from './stock-lines';
import type { LineVariant } from './stock-lines';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
// 6 November 2026, 10:00 in India: batches expiring from 6 May 2027 sell.
const NOW = new Date('2026-11-06T04:30:00.000Z');
const batch = (expiresOn: string, quantity: number, holds = NO_HOLDS) => ({
  expiresOn: day(expiresOn),
  quantity,
  holds,
});

describe('summarise', () => {
  it('adds up the free packs, those that sell, and those orders hold', () => {
    expect(
      summarise(
        [
          batch('2027-05-05', 4, { awaitingPacking: 1, packed: 0 }),
          batch('2028-09-30', 120, { awaitingPacking: 3, packed: 2 }),
          batch('2029-01-31', 5),
        ],
        10,
        NOW,
      ),
    ).toEqual({
      free: 129,
      sellable: 125,
      awaitingPacking: 4,
      packed: 2,
      level: 'OK',
      // The first of the batches that sell to stop: 30 September 2028's.
      stopsSellingOn: '2028-04-01',
      expiringSoon: false,
    });
  });

  it('is out of stock when only batches that no longer sell hold packs', () => {
    expect(summarise([batch('2027-05-05', 40)], 10, NOW)).toMatchObject({
      free: 40,
      sellable: 0,
      level: 'OUT',
      stopsSellingOn: null,
      expiringSoon: false,
    });
  });

  it('is low at its own number of packs that sell, or fewer', () => {
    expect(summarise([batch('2028-09-30', 10)], 10, NOW).level).toBe('LOW');
    expect(summarise([batch('2028-09-30', 11)], 10, NOW).level).toBe('OK');
    expect(summarise([batch('2028-09-30', 1)], 0, NOW).level).toBe('OK');
  });

  it('warns of a batch that holds packs and stops selling soon, not of an empty one', () => {
    // Stops selling on 6 December 2026, in 30 days.
    expect(summarise([batch('2027-06-05', 8), batch('2028-09-30', 50)], 10, NOW)).toMatchObject({
      stopsSellingOn: '2026-12-06',
      expiringSoon: true,
    });
    expect(summarise([batch('2027-06-05', 0), batch('2028-09-30', 50)], 10, NOW)).toMatchObject({
      stopsSellingOn: '2028-04-01',
      expiringSoon: false,
    });
  });

  it('is out of stock with no batches at all', () => {
    expect(summarise([], 10, NOW)).toEqual({
      free: 0,
      sellable: 0,
      awaitingPacking: 0,
      packed: 0,
      level: 'OUT',
      stopsSellingOn: null,
      expiringSoon: false,
    });
  });
});

describe('holdsOf', () => {
  function reader(answers: { batchId: string; _sum: { change: number | null } }[][]) {
    const groupBy = jest.fn();
    for (const answer of answers) {
      groupBy.mockResolvedValueOnce(answer);
    }
    return { db: { stockMovement: { groupBy } }, groupBy };
  }

  it("sums each batch's movements of orders waiting to be packed, then of packed ones", async () => {
    const { db, groupBy } = reader([
      [
        { batchId: 'b-1', _sum: { change: -3 } },
        { batchId: 'b-2', _sum: { change: -1 } },
      ],
      [{ batchId: 'b-1', _sum: { change: -2 } }],
    ]);

    await expect(holdsOf(db as never, ['b-1', 'b-2', 'b-3'])).resolves.toEqual(
      new Map([
        ['b-1', { awaitingPacking: 3, packed: 2 }],
        ['b-2', { awaitingPacking: 1, packed: 0 }],
      ]),
    );
    expect(groupBy.mock.calls).toEqual([
      [
        {
          by: ['batchId'],
          where: {
            batchId: { in: ['b-1', 'b-2', 'b-3'] },
            order: { is: { status: { in: ['PENDING_PAYMENT', 'PAID'] } } },
          },
          _sum: { change: true },
        },
      ],
      [
        {
          by: ['batchId'],
          where: {
            batchId: { in: ['b-1', 'b-2', 'b-3'] },
            order: { is: { status: { in: ['PACKED'] } } },
          },
          _sum: { change: true },
        },
      ],
    ]);
  });

  it('never holds less than nothing', async () => {
    const { db } = reader([[{ batchId: 'b-1', _sum: { change: 2 } }], [{ batchId: 'b-2', _sum: { change: null } }]]);

    await expect(holdsOf(db as never, ['b-1', 'b-2'])).resolves.toEqual(
      new Map([
        ['b-1', { awaitingPacking: 0, packed: 0 }],
        ['b-2', { awaitingPacking: 0, packed: 0 }],
      ]),
    );
  });

  it('asks nothing for no batches', async () => {
    const { db, groupBy } = reader([]);

    await expect(holdsOf(db as never, [])).resolves.toEqual(new Map());
    expect(groupBy).not.toHaveBeenCalled();
  });
});

describe('stockLine', () => {
  it('puts the pack size, its product and its stock side by side', () => {
    const variant: LineVariant = {
      id: 'v-1',
      sku: 'ASH-CAP-60',
      quantity: 60,
      unit: 'CAPSULES',
      isActive: false,
      lowStockAt: 10,
      position: 2,
      product: { id: 'p-1', name: 'Ashwagandha Capsules', isActive: true },
    };
    const stock = summarise([], 10, NOW);

    expect(stockLine(variant, stock)).toEqual({
      variant: {
        id: 'v-1',
        sku: 'ASH-CAP-60',
        quantity: 60,
        unit: 'CAPSULES',
        isActive: false,
        lowStockAt: 10,
        position: 2,
      },
      product: { id: 'p-1', name: 'Ashwagandha Capsules', isActive: true },
      stock,
    });
  });
});
