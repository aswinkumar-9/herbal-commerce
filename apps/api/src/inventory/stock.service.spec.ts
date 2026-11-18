import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BATCH_NOT_FOUND,
  BATCH_NUMBER_TAKEN,
  COUNT_CHANGED,
  COUNT_NEEDS_NOTE,
  fewerThanOrdersNeed,
  NotEnoughStockError,
  PACK_NOT_FOUND,
  StockService,
} from './stock.service';

const VARIANT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PRODUCT = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';
const BATCH = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
// 6 November 2026, 10:00 in India: batches expiring from 6 May 2027 sell.
const NOW = new Date('2026-11-06T04:30:00.000Z');
const createdAt = new Date('2026-11-06T04:00:00.000Z');
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const withCode = (code: string) =>
  Object.assign(new Error('Prisma error'), { code });

// A batch as the query returns it.
function row(changes: object = {}) {
  return {
    id: BATCH,
    variantId: VARIANT,
    batchNumber: 'AB2611',
    manufacturedOn: day('2026-10-01'),
    expiresOn: day('2028-09-30'),
    quantity: 120,
    createdAt,
    updatedAt: createdAt,
    ...changes,
  };
}
// The same batch as staff see it. It sells until 31 March 2028, 6 months
// before it expires. Those waiting to be packed are on the shelf too.
function shown(changes: Record<string, unknown> = {}) {
  const view = {
    ...row(),
    manufacturedOn: '2026-10-01',
    expiresOn: '2028-09-30',
    sellable: true,
    stopsSellingOn: '2028-04-01',
    awaitingPacking: 0,
    packed: 0,
    ...changes,
  };
  return { onShelf: view.quantity + view.awaitingPacking, ...view };
}
// The pack size the batches belong to, as the query returns it.
const pack = {
  id: VARIANT,
  sku: 'ASH-CAP-60',
  quantity: 60,
  unit: 'CAPSULES',
  isActive: true,
  lowStockAt: 10,
  position: 0,
  product: { id: PRODUCT, name: 'Ashwagandha Capsules', isActive: true },
};
// Answers the two questions about what orders hold of each batch: packs
// still waiting to be packed, and packs in packed orders.
function holding(awaiting: Record<string, number>, packed: Record<string, number> = {}) {
  return ({ where }: { where: { order: { is: { status: { in: string[] } } } } }) =>
    Promise.resolve(
      Object.entries(where.order.is.status.in.includes('PACKED') ? packed : awaiting).map(
        ([batchId, packs]) => ({ batchId, _sum: { change: -packs } }),
      ),
    );
}
const received = {
  batchNumber: 'AB2611',
  manufacturedOn: day('2026-10-01'),
  expiresOn: day('2028-09-30'),
  quantity: 120,
  note: 'First delivery',
};

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: BATCH }]),
    stockBatch: {
      create: jest.fn().mockResolvedValue({ id: BATCH }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
      update: jest.fn().mockResolvedValue(row()),
      findMany: jest.fn().mockResolvedValue([]),
    },
    stockMovement: {
      create: jest.fn().mockResolvedValue({ id: 'm-1' }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    productVariant: { findUnique: jest.fn() },
    stockBatch: {
      findUnique: jest.fn().mockResolvedValue({ id: BATCH }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    stockMovement: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn() };
  const service = new StockService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, audit, logger };
}

// The errors a refused request answers with.
async function refusal(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  return (error as BadRequestException).getResponse();
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('StockService.listBatches', () => {
  it('lists the batches, the first to expire first, with the pack size and its packs on hand and those that sell', async () => {
    const { service, prisma } = setup();
    const short = row({ id: 'b-2', batchNumber: 'AA0505', expiresOn: day('2027-05-05'), quantity: 4 });
    prisma.productVariant.findUnique.mockResolvedValue({ ...pack, batches: [short, row()] });

    await expect(service.listBatches(VARIANT)).resolves.toEqual({
      variant: { id: VARIANT, sku: 'ASH-CAP-60', quantity: 60, unit: 'CAPSULES', isActive: true, lowStockAt: 10, position: 0 },
      product: { id: PRODUCT, name: 'Ashwagandha Capsules', isActive: true },
      stock: {
        free: 124,
        sellable: 120,
        awaitingPacking: 0,
        packed: 0,
        level: 'OK',
        stopsSellingOn: '2028-04-01',
        expiringSoon: false,
      },
      batches: [
        shown({
          id: 'b-2',
          batchNumber: 'AA0505',
          expiresOn: '2027-05-05',
          quantity: 4,
          sellable: false,
          stopsSellingOn: '2026-11-06',
        }),
        shown(),
      ],
      quantity: 124,
      sellableQuantity: 120,
    });
    expect(prisma.productVariant.findUnique).toHaveBeenCalledWith({
      where: { id: VARIANT },
      select: expect.objectContaining({
        product: { select: { id: true, name: true, isActive: true } },
        lowStockAt: true,
        batches: {
          orderBy: [{ expiresOn: 'asc' }, { batchNumber: 'asc' }],
          select: expect.any(Object),
        },
      }),
    });
  });

  it("shows what orders hold of each batch until they ship: on the shelf until packed, then in their boxes", async () => {
    const { service, prisma } = setup();
    const other = row({ id: 'b-2', batchNumber: 'AB2700', expiresOn: day('2029-01-31'), quantity: 5 });
    prisma.productVariant.findUnique.mockResolvedValue({ ...pack, batches: [row(), other] });
    prisma.stockMovement.groupBy.mockImplementation(holding({ [BATCH]: 3 }, { [BATCH]: 2, 'b-2': 1 }));

    const list = await service.listBatches(VARIANT);

    expect(list.batches).toEqual([
      shown({ awaitingPacking: 3, packed: 2 }),
      shown({
        id: 'b-2',
        batchNumber: 'AB2700',
        expiresOn: '2029-01-31',
        quantity: 5,
        stopsSellingOn: '2028-08-01',
        packed: 1,
      }),
    ]);
    expect(list.batches[0].onShelf).toBe(123);
    expect(list.stock).toMatchObject({ free: 125, awaitingPacking: 3, packed: 3 });
    // Only these batches, and only orders that have not shipped.
    expect(prisma.stockMovement.groupBy).toHaveBeenCalledWith({
      by: ['batchId'],
      where: {
        batchId: { in: [BATCH, 'b-2'] },
        order: { is: { status: { in: ['PENDING_PAYMENT', 'PAID'] } } },
      },
      _sum: { change: true },
    });
    expect(prisma.stockMovement.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ order: { is: { status: { in: ['PACKED'] } } } }) }),
    );
  });

  it('says when the stock is low, at its own number of packs', async () => {
    const { service, prisma } = setup();
    prisma.productVariant.findUnique.mockResolvedValue({
      ...pack,
      lowStockAt: 120,
      batches: [row()],
    });

    await expect(service.listBatches(VARIANT)).resolves.toMatchObject({
      stock: { level: 'LOW', sellable: 120 },
    });
  });

  it('asks nothing about orders for a pack size without batches', async () => {
    const { service, prisma } = setup();
    prisma.productVariant.findUnique.mockResolvedValue({ ...pack, batches: [] });

    await expect(service.listBatches(VARIANT)).resolves.toMatchObject({
      batches: [],
      stock: { free: 0, sellable: 0, level: 'OUT', stopsSellingOn: null },
      quantity: 0,
      sellableQuantity: 0,
    });
    expect(prisma.stockMovement.groupBy).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown pack size', async () => {
    const { service, prisma } = setup();
    prisma.productVariant.findUnique.mockResolvedValue(null);

    await expect(service.listBatches(VARIANT)).rejects.toThrow(
      new NotFoundException(PACK_NOT_FOUND),
    );
  });
});

describe('StockService.inStock', () => {
  it('names the pack sizes with a sellable batch that holds stock, once each', async () => {
    const { service, prisma } = setup();
    prisma.stockBatch.findMany.mockResolvedValue([{ variantId: 'v-1' }, { variantId: 'v-3' }]);

    await expect(service.inStock(['v-1', 'v-2', 'v-3'])).resolves.toEqual(
      new Set(['v-1', 'v-3']),
    );
    expect(prisma.stockBatch.findMany).toHaveBeenCalledWith({
      where: {
        variantId: { in: ['v-1', 'v-2', 'v-3'] },
        quantity: { gt: 0 },
        // 6 months from 6 November 2026, in India.
        expiresOn: { gte: day('2027-05-06') },
      },
      distinct: ['variantId'],
      select: { variantId: true },
    });
  });

  it('asks nothing for no pack sizes', async () => {
    const { service, prisma } = setup();

    await expect(service.inStock([])).resolves.toEqual(new Set());
    expect(prisma.stockBatch.findMany).not.toHaveBeenCalled();
  });
});

describe('StockService.receive', () => {
  it('creates the batch, then its delivery, and reads it back as the database left it, in one transaction', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(service.receive(VARIANT, received, context)).resolves.toEqual(shown());

    expect(tx.stockBatch.create).toHaveBeenCalledWith({
      data: {
        batchNumber: 'AB2611',
        manufacturedOn: day('2026-10-01'),
        expiresOn: day('2028-09-30'),
        variantId: VARIANT,
      },
      select: { id: true },
    });
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: {
        batchId: BATCH,
        change: 120,
        reason: 'RECEIVED',
        note: 'First delivery',
        actorId: context.actorId,
      },
      select: { id: true },
    });
    expect(tx.stockBatch.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.stockMovement.create.mock.invocationCallOrder[0],
    );
    expect(tx.stockMovement.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.stockBatch.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'batch.received',
      targetType: 'batch',
      targetId: BATCH,
      after: {
        variantId: VARIANT,
        batchNumber: 'AB2611',
        manufacturedOn: '2026-10-01',
        expiresOn: '2028-09-30',
        quantity: 120,
        note: 'First delivery',
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { batchId: BATCH, variantId: VARIANT, actorId: context.actorId },
      'Batch received',
    );
  });

  it('refuses a batch made in the future, or already expired, before any work', async () => {
    const { service, prisma } = setup();

    await expect(
      refusal(service.receive(VARIANT, { ...received, manufacturedOn: day('2026-11-07') }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'manufacturedOn', message: 'The manufacturing date cannot be in the future' }],
    });
    await expect(
      refusal(
        service.receive(
          VARIANT,
          { ...received, manufacturedOn: day('2025-11-06'), expiresOn: day('2026-11-06') },
          context,
        ),
      ),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'expiresOn', message: 'This batch has already expired' }],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('receives a batch too short-dated to sell, which staff then see as not sellable', async () => {
    const { service, tx } = setup();
    tx.stockBatch.findUniqueOrThrow.mockResolvedValue(row({ expiresOn: day('2027-01-31') }));

    await expect(
      service.receive(VARIANT, { ...received, expiresOn: day('2027-01-31') }, context),
    ).resolves.toMatchObject({ expiresOn: '2027-01-31', sellable: false });
  });

  it('answers 409 for a batch number the pack size has, 404 for an unknown pack size, and passes on the rest', async () => {
    const { service, tx } = setup();

    tx.stockBatch.create.mockRejectedValueOnce(withCode('P2002'));
    await expect(service.receive(VARIANT, received, context)).rejects.toThrow(
      new ConflictException(BATCH_NUMBER_TAKEN),
    );
    tx.stockBatch.create.mockRejectedValueOnce(withCode('P2003'));
    await expect(service.receive(VARIANT, received, context)).rejects.toThrow(
      new NotFoundException(PACK_NOT_FOUND),
    );
    const broken = new Error('Database unavailable');
    tx.stockBatch.create.mockRejectedValueOnce(broken);
    await expect(service.receive(VARIANT, received, context)).rejects.toBe(broken);
  });
});

describe('StockService.updateBatch', () => {
  it('locks the batch, saves only the label details that change, and records them', async () => {
    const { service, tx, audit, logger } = setup();
    tx.stockBatch.update.mockResolvedValue(row({ expiresOn: day('2028-10-31') }));

    await expect(
      service.updateBatch(BATCH, { batchNumber: 'AB2611', expiresOn: day('2028-10-31') }, context),
    ).resolves.toEqual(shown({ expiresOn: '2028-10-31', stopsSellingOn: '2028-05-01' }));

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM stock_batches WHERE id = \?::uuid FOR UPDATE/);
    expect(id).toBe(BATCH);
    expect(tx.stockBatch.update).toHaveBeenCalledWith({
      where: { id: BATCH },
      data: { expiresOn: day('2028-10-31') },
      select: expect.any(Object),
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'batch.updated',
      targetType: 'batch',
      targetId: BATCH,
      before: { expiresOn: '2028-09-30' },
      after: { expiresOn: '2028-10-31' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { batchId: BATCH, actorId: context.actorId },
      'Batch changed',
    );
  });

  it('shows what orders hold of the batch once it is saved', async () => {
    const { service, prisma, tx } = setup();
    tx.stockBatch.update.mockResolvedValue(row({ batchNumber: 'AB2612' }));
    prisma.stockMovement.groupBy.mockImplementation(holding({ [BATCH]: 4 }));

    await expect(service.updateBatch(BATCH, { batchNumber: 'AB2612' }, context)).resolves.toEqual(
      shown({ batchNumber: 'AB2612', awaitingPacking: 4 }),
    );
    expect(prisma.stockMovement.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ batchId: { in: [BATCH] } }) }),
    );
  });

  it('changes and records nothing when the label already says so', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.updateBatch(BATCH, { manufacturedOn: day('2026-10-01'), expiresOn: day('2028-09-30') }, context),
    ).resolves.toEqual(shown());
    expect(tx.stockBatch.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('checks the dates of the batch as it will be', async () => {
    const { service, tx } = setup();

    await expect(
      refusal(service.updateBatch(BATCH, { manufacturedOn: day('2026-11-06'), expiresOn: day('2026-11-05') }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'expiresOn', message: 'The expiry date must be after the manufacturing date' }],
    });
    // Only the manufacturing date sent: the stored expiry still counts.
    await expect(
      refusal(service.updateBatch(BATCH, { manufacturedOn: day('2028-09-30') }, context)),
    ).resolves.toMatchObject({ errors: [{ field: 'manufacturedOn' }, { field: 'expiresOn' }] });
    expect(tx.stockBatch.update).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown batch, and 409 for a batch number already taken', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.updateBatch(BATCH, { batchNumber: 'AB2612' }, context)).rejects.toThrow(
      new NotFoundException(BATCH_NOT_FOUND),
    );
    tx.stockBatch.update.mockRejectedValueOnce(withCode('P2002'));
    await expect(service.updateBatch(BATCH, { batchNumber: 'AB2612' }, context)).rejects.toThrow(
      new ConflictException(BATCH_NUMBER_TAKEN),
    );
  });
});

describe('StockService.addMovement', () => {
  it('locks the batch, adds the movement, and records the quantity before and after', async () => {
    const { service, tx, audit, logger } = setup();
    tx.stockBatch.findUniqueOrThrow
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ quantity: 118 }));

    await expect(
      service.addMovement(BATCH, { change: -2, reason: 'DAMAGED', note: 'Broken seal' }, context),
    ).resolves.toEqual(shown({ quantity: 118 }));

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.stockMovement.create.mock.invocationCallOrder[0],
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: { batchId: BATCH, change: -2, reason: 'DAMAGED', note: 'Broken seal', actorId: context.actorId },
      select: { id: true },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'stock.changed',
      targetType: 'batch',
      targetId: BATCH,
      before: { quantity: 120 },
      after: { quantity: 118, change: -2, reason: 'DAMAGED', note: 'Broken seal' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { batchId: BATCH, actorId: context.actorId, reason: 'DAMAGED' },
      'Stock changed',
    );
  });

  it('shows what orders hold of the batch once the change is saved', async () => {
    const { service, prisma, tx } = setup();
    tx.stockBatch.findUniqueOrThrow
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ quantity: 118 }));
    prisma.stockMovement.groupBy.mockImplementation(holding({ [BATCH]: 2 }, { [BATCH]: 1 }));

    await expect(
      service.addMovement(BATCH, { change: -2, reason: 'DAMAGED' }, context),
    ).resolves.toEqual(shown({ quantity: 118, awaitingPacking: 2, packed: 1 }));
  });

  it('refuses taking more than the batch holds with 409, but may take it all', async () => {
    const { service, tx, audit } = setup();

    await expect(
      service.addMovement(BATCH, { change: -121, reason: 'CORRECTION', note: 'Count' }, context),
    ).rejects.toThrow(new ConflictException('Not enough stock: this batch holds 120.'));
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    await service.addMovement(BATCH, { change: -120, reason: 'EXPIRED' }, context);
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it('refuses receiving more of an expired batch, but lets it be written off', async () => {
    const { service, tx } = setup();
    tx.stockBatch.findUniqueOrThrow.mockResolvedValue(row({ expiresOn: day('2026-11-06') }));

    await expect(
      refusal(service.addMovement(BATCH, { change: 5, reason: 'RECEIVED' }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'expiresOn', message: 'This batch has already expired' }],
    });
    expect(tx.stockMovement.create).not.toHaveBeenCalled();

    await service.addMovement(BATCH, { change: -120, reason: 'EXPIRED' }, context);
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for an unknown batch, and changes nothing', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.addMovement(BATCH, { change: 5, reason: 'RECEIVED' }, context),
    ).rejects.toThrow(new NotFoundException(BATCH_NOT_FOUND));
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
});

describe('StockService.count', () => {
  // 120 free, and 3 more on the shelf for orders waiting to be packed.
  function counting() {
    const fixture = setup();
    fixture.tx.stockMovement.groupBy.mockImplementation(holding({ [BATCH]: 3 }, { [BATCH]: 5 }));
    return fixture;
  }

  it('locks the batch, then turns a count that differs into a correction with its note', async () => {
    const { service, tx, audit, logger } = counting();
    tx.stockBatch.findUniqueOrThrow
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ quantity: 114 }));

    await expect(
      service.count(BATCH, { counted: 117, onShelf: 123, note: 'Shelf count' }, context),
    ).resolves.toEqual({
      batch: shown({ quantity: 114, awaitingPacking: 3, packed: 5 }),
      change: -6,
    });

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM stock_batches WHERE id = \?::uuid FOR UPDATE/);
    expect(id).toBe(BATCH);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.stockMovement.groupBy.mock.invocationCallOrder[0],
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: { batchId: BATCH, change: -6, reason: 'CORRECTION', note: 'Shelf count', actorId: context.actorId },
      select: { id: true },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'stock.counted',
      targetType: 'batch',
      targetId: BATCH,
      before: { quantity: 120, onShelf: 123 },
      after: { quantity: 114, onShelf: 117, change: -6, note: 'Shelf count' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { batchId: BATCH, actorId: context.actorId, change: -6 },
      'Stock counted',
    );
  });

  it('adds what the count found over, and leaves the packed orders out of the shelf', async () => {
    const { service, tx } = counting();

    await expect(
      service.count(BATCH, { counted: 125, onShelf: 123, note: 'Found behind the shelf' }, context),
    ).resolves.toMatchObject({ change: 2 });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ change: 2, reason: 'CORRECTION' }) }),
    );
  });

  it('saves and records nothing when the count matches, without a note', async () => {
    const { service, tx, audit, logger } = counting();

    await expect(service.count(BATCH, { counted: 123, onShelf: 123 }, context)).resolves.toEqual({
      batch: shown({ awaitingPacking: 3, packed: 5 }),
      change: 0,
    });
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { batchId: BATCH, actorId: context.actorId, change: 0 },
      'Count matched',
    );
  });

  it('refuses with 409 when the stock changed while staff counted', async () => {
    const { service, tx, audit } = counting();

    for (const onShelf of [120, 124]) {
      await expect(
        service.count(BATCH, { counted: 100, onShelf, note: 'Shelf count' }, context),
      ).rejects.toThrow(new ConflictException(COUNT_CHANGED));
    }
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('wants a note for a count that differs', async () => {
    const { service, tx } = counting();

    await expect(
      refusal(service.count(BATCH, { counted: 122, onShelf: 123 }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'note', message: COUNT_NEEDS_NOTE }],
    });
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('refuses with 409 a count below what the orders waiting to be packed need', async () => {
    const { service, tx } = counting();
    tx.stockBatch.findUniqueOrThrow.mockResolvedValue(row({ quantity: 0 }));

    await expect(
      service.count(BATCH, { counted: 2, onShelf: 3, note: 'Shelf count' }, context),
    ).rejects.toThrow(new ConflictException(fewerThanOrdersNeed(3)));
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    // All of them there, and no free ones: nothing to put right.
    await expect(
      service.count(BATCH, { counted: 3, onShelf: 3 }, context),
    ).resolves.toMatchObject({ change: 0 });
  });

  it('may leave no free pack: only what the orders waiting to be packed need', async () => {
    const { service, tx } = counting();

    await expect(
      service.count(BATCH, { counted: 3, onShelf: 123, note: 'Only the ordered ones left' }, context),
    ).resolves.toMatchObject({ change: -120 });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ change: -120 }) }),
    );
  });

  it('answers 404 for an unknown batch, and changes nothing', async () => {
    const { service, tx } = counting();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.count(BATCH, { counted: 1, onShelf: 1 }, context),
    ).rejects.toThrow(new NotFoundException(BATCH_NOT_FOUND));
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
});

describe('StockService.listMovements', () => {
  const movement = (id: string) => ({
    id,
    batchId: BATCH,
    change: -1,
    reason: 'DAMAGED',
    note: null,
    actorId: context.actorId,
    createdAt,
  });

  it("lists a batch's movements, newest first, one page at a time", async () => {
    const { service, prisma } = setup();
    prisma.stockMovement.findMany.mockResolvedValue([movement('m-3'), movement('m-2'), movement('m-1')]);

    await expect(service.listMovements(BATCH, { limit: 2, before: 'm-4' })).resolves.toEqual({
      movements: [movement('m-3'), movement('m-2')],
      nextBefore: 'm-2',
    });
    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith({
      where: { batchId: BATCH },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      cursor: { id: 'm-4' },
      skip: 1,
      select: expect.any(Object),
    });

    prisma.stockMovement.findMany.mockResolvedValue([movement('m-1')]);
    await expect(service.listMovements(BATCH, { limit: 50 })).resolves.toEqual({
      movements: [movement('m-1')],
      nextBefore: null,
    });
  });

  it('answers 404 for an unknown batch, and looks for no movements', async () => {
    const { service, prisma } = setup();
    prisma.stockBatch.findUnique.mockResolvedValue(null);

    await expect(service.listMovements(BATCH, { limit: 50 })).rejects.toThrow(
      new NotFoundException(BATCH_NOT_FOUND),
    );
    expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
  });
});

describe('StockService.take, for an order', () => {
  const ORDER = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';
  const OTHER = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

  it('takes the packs from the sellable batches, the first to expire first, after locking them in the order of their IDs', async () => {
    const { service, tx } = setup();
    tx.stockBatch.findMany
      .mockResolvedValueOnce([{ id: 'b-1' }, { id: 'b-2' }, { id: 'b-3' }])
      .mockResolvedValueOnce([
        { id: 'b-2', variantId: VARIANT, quantity: 1 },
        { id: 'b-1', variantId: VARIANT, quantity: 5 },
        { id: 'b-3', variantId: OTHER, quantity: 4 },
      ]);

    await service.take(
      tx as never,
      ORDER,
      [
        { variantId: VARIANT, packs: 3 },
        { variantId: OTHER, packs: 2 },
      ],
      NOW,
    );

    // Batches with stock that have at least 6 months left on 6 November
    // 2026, in the order of their IDs.
    expect(tx.stockBatch.findMany.mock.calls[0][0]).toEqual({
      where: {
        variantId: { in: [VARIANT, OTHER] },
        quantity: { gt: 0 },
        expiresOn: { gte: day('2027-05-06') },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const locked = tx.$queryRaw.mock.calls.map((call) => call[1] as string);
    expect(locked).toEqual(['b-1', 'b-2', 'b-3']);
    // Read again once locked, the first to expire first.
    expect(tx.stockBatch.findMany.mock.calls[1][0]).toEqual({
      where: { id: { in: ['b-1', 'b-2', 'b-3'] } },
      orderBy: [{ expiresOn: 'asc' }, { batchNumber: 'asc' }],
      select: { id: true, variantId: true, quantity: true },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      tx.stockBatch.findMany.mock.invocationCallOrder[1],
    );
    expect(tx.stockMovement.createMany).toHaveBeenCalledWith({
      data: [
        { batchId: 'b-2', change: -1, reason: 'ORDERED', orderId: ORDER },
        { batchId: 'b-1', change: -2, reason: 'ORDERED', orderId: ORDER },
        { batchId: 'b-3', change: -2, reason: 'ORDERED', orderId: ORDER },
      ],
    });
  });

  it('skips a batch that another order emptied meanwhile', async () => {
    const { service, tx } = setup();
    tx.stockBatch.findMany
      .mockResolvedValueOnce([{ id: 'b-1' }, { id: 'b-2' }])
      .mockResolvedValueOnce([
        { id: 'b-2', variantId: VARIANT, quantity: 0 },
        { id: 'b-1', variantId: VARIANT, quantity: 5 },
      ]);

    await service.take(
      tx as never,
      ORDER,
      [{ variantId: VARIANT, packs: 4 }],
      NOW,
    );

    expect(tx.stockMovement.createMany).toHaveBeenCalledWith({
      data: [{ batchId: 'b-1', change: -4, reason: 'ORDERED', orderId: ORDER }],
    });
  });

  it('refuses when a pack size has too little sellable stock, naming it, and takes nothing', async () => {
    const { service, tx } = setup();
    tx.stockBatch.findMany
      .mockResolvedValueOnce([{ id: 'b-1' }, { id: 'b-3' }])
      .mockResolvedValueOnce([
        { id: 'b-1', variantId: VARIANT, quantity: 5 },
        { id: 'b-3', variantId: OTHER, quantity: 1 },
      ]);

    const refusal = service.take(
      tx as never,
      ORDER,
      [
        { variantId: VARIANT, packs: 4 },
        { variantId: OTHER, packs: 2 },
      ],
      NOW,
    );

    await expect(refusal).rejects.toThrow(NotEnoughStockError);
    await expect(refusal).rejects.toMatchObject({ variantId: OTHER });
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });

  it('refuses a pack size without any sellable batch', async () => {
    const { service, tx } = setup();

    await expect(
      service.take(tx as never, ORDER, [{ variantId: VARIANT, packs: 1 }], NOW),
    ).rejects.toMatchObject({ variantId: VARIANT });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });
});

describe('StockService.release, for an order cancelled or expired', () => {
  const ORDER = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';

  it('gives back to each batch what the order still holds of it, in the order of the batch IDs', async () => {
    const { service, tx } = setup();
    tx.stockMovement.groupBy.mockResolvedValue([
      { batchId: 'b-1', _sum: { change: -2 } },
      { batchId: 'b-2', _sum: { change: 0 } },
      { batchId: 'b-3', _sum: { change: -1 } },
    ]);

    await service.release(tx as never, ORDER);

    expect(tx.stockMovement.groupBy).toHaveBeenCalledWith({
      by: ['batchId'],
      where: { orderId: ORDER },
      _sum: { change: true },
      orderBy: { batchId: 'asc' },
    });
    // b-2 was given back already: nothing more for it.
    expect(tx.stockMovement.createMany).toHaveBeenCalledWith({
      data: [
        { batchId: 'b-1', change: 2, reason: 'RELEASED', orderId: ORDER },
        { batchId: 'b-3', change: 1, reason: 'RELEASED', orderId: ORDER },
      ],
    });
  });

  it('writes nothing when the order holds nothing, or its batches are gone', async () => {
    const { service, tx } = setup();

    await service.release(tx as never, ORDER);
    tx.stockMovement.groupBy.mockResolvedValue([
      { batchId: 'b-1', _sum: { change: 0 } },
    ]);
    await service.release(tx as never, ORDER);

    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });
});
