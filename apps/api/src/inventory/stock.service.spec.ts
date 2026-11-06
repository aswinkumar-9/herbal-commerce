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
  PACK_NOT_FOUND,
  StockService,
} from './stock.service';

const VARIANT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
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
// The same batch as staff see it.
function shown(changes: object = {}) {
  return {
    ...row(),
    manufacturedOn: '2026-10-01',
    expiresOn: '2028-09-30',
    sellable: true,
    ...changes,
  };
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
    },
    stockMovement: { create: jest.fn().mockResolvedValue({ id: 'm-1' }) },
  };
  const prisma = {
    productVariant: { findUnique: jest.fn() },
    stockBatch: {
      findUnique: jest.fn().mockResolvedValue({ id: BATCH }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    stockMovement: { findMany: jest.fn().mockResolvedValue([]) },
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
  it('lists the batches, the first to expire first, with the packs on hand and those that sell', async () => {
    const { service, prisma } = setup();
    const short = row({ id: 'b-2', batchNumber: 'AA0505', expiresOn: day('2027-05-05'), quantity: 4 });
    prisma.productVariant.findUnique.mockResolvedValue({ batches: [short, row()] });

    await expect(service.listBatches(VARIANT)).resolves.toEqual({
      batches: [
        shown({ id: 'b-2', batchNumber: 'AA0505', expiresOn: '2027-05-05', quantity: 4, sellable: false }),
        shown(),
      ],
      quantity: 124,
      sellableQuantity: 120,
    });
    expect(prisma.productVariant.findUnique).toHaveBeenCalledWith({
      where: { id: VARIANT },
      select: {
        batches: {
          orderBy: [{ expiresOn: 'asc' }, { batchNumber: 'asc' }],
          select: expect.any(Object),
        },
      },
    });
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
    ).resolves.toEqual(shown({ expiresOn: '2028-10-31' }));

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
