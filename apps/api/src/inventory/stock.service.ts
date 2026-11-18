import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { validationFailed } from '../catalog/validation-failed';
import type { Prisma } from '../generated/prisma/client';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  holdsOf,
  labelDay,
  LINE_FIELDS,
  NO_HOLDS,
  stockLine,
  summarise,
} from './stock-lines';
import type { Holds, StockLine } from './stock-lines';
import {
  batchDateIssues,
  expiredIssues,
  isSellable,
  sellableFrom,
  stopsSellingOn,
} from './stock-rules';
import type {
  BatchInput,
  BatchUpdateInput,
  CountInput,
  MovementInput,
  MovementListQuery,
} from './stock.schemas';

export const PACK_NOT_FOUND = 'Pack size not found';
export const BATCH_NOT_FOUND = 'Batch not found';
export const BATCH_NUMBER_TAKEN =
  'This pack size already has a batch with this number.';
export const notEnoughStock = (held: number) =>
  `Not enough stock: this batch holds ${held}.`;
export const COUNT_CHANGED =
  "This batch's stock changed while you were counting. Check the new numbers and count again.";
export const COUNT_NEEDS_NOTE = 'Say why the count differs';
export const fewerThanOrdersNeed = (packs: number) =>
  `Orders waiting to be packed need ${packs} packs of this batch, more than the count found. Check those orders before correcting the count.`;

// An order wanted more of a pack size than its sellable batches hold
// (ADR 0026). Orders turn it into an answer that names the pack.
export class NotEnoughStockError extends Error {
  constructor(readonly variantId: string) {
    super('Not enough sellable stock for this pack size');
  }
}

const BATCH_FIELDS = {
  id: true,
  variantId: true,
  batchNumber: true,
  manufacturedOn: true,
  expiresOn: true,
  quantity: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StockBatchSelect;

type BatchRow = Prisma.StockBatchGetPayload<{ select: typeof BATCH_FIELDS }>;

const MOVEMENT_FIELDS = {
  id: true,
  batchId: true,
  change: true,
  reason: true,
  note: true,
  actorId: true,
  createdAt: true,
} satisfies Prisma.StockMovementSelect;

// A pack size's batches, the first to expire first: the order in which
// orders will take them.
const BATCH_ORDER = [
  { expiresOn: 'asc' },
  { batchNumber: 'asc' },
] satisfies Prisma.StockBatchOrderByWithRelationInput[];

// A batch as staff see it: its dates as on the label, such as 2028-09-30,
// whether it may be sold today and from when it no longer may, and the
// packs orders took but have not shipped (ADR 0034). Those waiting to be
// packed are still on the shelf, with the free ones.
export type StaffBatch = Omit<BatchRow, 'manufacturedOn' | 'expiresOn'> & {
  manufacturedOn: string;
  expiresOn: string;
  sellable: boolean;
  stopsSellingOn: string;
  awaitingPacking: number;
  packed: number;
  onShelf: number;
};

// A pack size's batches, with the pack size and its stock summed up.
export type BatchList = StockLine & {
  batches: StaffBatch[];
  // As before part 12D: the same as stock.free and stock.sellable.
  quantity: number;
  sellableQuantity: number;
};

// The label details of a batch, the part staff may correct.
interface BatchLabel {
  batchNumber: string;
  manufacturedOn: string;
  expiresOn: string;
}

// The stock of pack sizes, batch by batch (ADR 0024). Admins and Super
// Users receive batches, correct their labels and change their stock.
// Every change is a movement, which the database applies to its batch, and
// is written to the audit log in the same transaction.
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(StockService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Every batch of a pack size, the first to expire first, with the pack
  // size, how many packs are on hand, how many of them may be sold today,
  // and those orders hold until they ship.
  async listBatches(variantId: string): Promise<BatchList> {
    const found = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        ...LINE_FIELDS,
        batches: { orderBy: BATCH_ORDER, select: BATCH_FIELDS },
      },
    });
    if (!found) {
      throw new NotFoundException(PACK_NOT_FOUND);
    }
    const now = new Date();
    const { batches: rows, ...variant } = found;
    const holds = await holdsOf(
      this.prisma,
      rows.map((batch) => batch.id),
    );
    const held = (batch: BatchRow) => holds.get(batch.id) ?? NO_HOLDS;
    const stock = summarise(
      rows.map((batch) => ({ ...batch, holds: held(batch) })),
      variant.lowStockAt,
      now,
    );
    return {
      ...stockLine(variant, stock),
      batches: rows.map((batch) => staffView(batch, held(batch), now)),
      quantity: stock.free,
      sellableQuantity: stock.sellable,
    };
  }

  // Which of these pack sizes can be bought today: those with a batch that
  // holds stock and has at least 6 months left. The shop shows only this,
  // never a count (ADR 0024).
  async inStock(variantIds: string[]): Promise<Set<string>> {
    if (variantIds.length === 0) {
      return new Set();
    }
    const batches = await this.prisma.stockBatch.findMany({
      where: {
        variantId: { in: variantIds },
        quantity: { gt: 0 },
        expiresOn: { gte: sellableFrom(new Date()) },
      },
      distinct: ['variantId'],
      select: { variantId: true },
    });
    return new Set(batches.map((batch) => batch.variantId));
  }

  // Receives a delivery: a new batch and its first movement, in one
  // transaction. The database applies the movement, so the batch holds the
  // packs that came. A batch that has expired already is refused.
  async receive(
    variantId: string,
    input: BatchInput,
    context: AuditContext,
  ): Promise<StaffBatch> {
    const now = new Date();
    const issues = [
      ...batchDateIssues(input, now),
      ...expiredIssues(input.expiresOn, now),
    ];
    if (issues.length > 0) {
      throw validationFailed(issues);
    }
    const { quantity, note, ...label } = input;
    const batch = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.stockBatch.create({
          data: { ...label, variantId },
          select: { id: true },
        });
        await tx.stockMovement.create({
          data: {
            batchId: created.id,
            change: quantity,
            reason: 'RECEIVED',
            note: note ?? null,
            actorId: context.actorId ?? null,
          },
          select: { id: true },
        });
        const saved = await tx.stockBatch.findUniqueOrThrow({
          where: { id: created.id },
          select: BATCH_FIELDS,
        });
        // In the same transaction: no stock without its audit entry.
        await this.audit.record(tx, {
          ...context,
          action: 'batch.received',
          targetType: 'batch',
          targetId: saved.id,
          after: {
            variantId,
            ...labelOf(saved),
            quantity: saved.quantity,
            note: note ?? null,
          },
        });
        return saved;
      }),
    );
    this.logger.info(
      { batchId: batch.id, variantId, actorId: context.actorId },
      'Batch received',
    );
    // A new batch: no order has taken any of it yet.
    return staffView(batch, NO_HOLDS, now);
  }

  // Corrects a batch's label details, checked on the batch as it will be.
  // Its stock never changes here. A request with no real change is not
  // audited.
  async updateBatch(
    id: string,
    input: BatchUpdateInput,
    context: AuditContext,
  ): Promise<StaffBatch> {
    const now = new Date();
    const { batch, changed } = await this.saving(() =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lockedBatch(tx, id);
        const merged = {
          batchNumber: input.batchNumber ?? current.batchNumber,
          manufacturedOn: input.manufacturedOn ?? current.manufacturedOn,
          expiresOn: input.expiresOn ?? current.expiresOn,
        };
        const before = labelOf(current);
        const after = labelOf(merged);
        const fields = (Object.keys(after) as (keyof BatchLabel)[]).filter(
          (field) => after[field] !== before[field],
        );
        if (fields.length === 0) {
          return { batch: current, changed: false };
        }
        const issues = batchDateIssues(merged, now);
        if (issues.length > 0) {
          throw validationFailed(issues);
        }
        const updated = await tx.stockBatch.update({
          where: { id },
          data: Object.fromEntries(fields.map((field) => [field, merged[field]])),
          select: BATCH_FIELDS,
        });
        await this.audit.record(tx, {
          ...context,
          action: 'batch.updated',
          targetType: 'batch',
          targetId: id,
          before: only(before, fields),
          after: only(after, fields),
        });
        return { batch: updated, changed: true };
      }),
    );
    if (changed) {
      this.logger.info(
        { batchId: id, actorId: context.actorId },
        'Batch changed',
      );
    }
    return staffView(batch, await this.holdsOfBatch(id), now);
  }

  // Changes a batch's stock by one movement. The batch is locked first, so
  // the check sees its real quantity: stock never goes below 0, and the
  // database refuses that too. More of a batch that has expired cannot be
  // received.
  async addMovement(
    batchId: string,
    input: MovementInput,
    context: AuditContext,
  ): Promise<StaffBatch> {
    const now = new Date();
    const batch = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedBatch(tx, batchId);
      if (input.reason === 'RECEIVED') {
        const issues = expiredIssues(current.expiresOn, now);
        if (issues.length > 0) {
          throw validationFailed(issues);
        }
      }
      if (current.quantity + input.change < 0) {
        throw new ConflictException(notEnoughStock(current.quantity));
      }
      const note = input.note ?? null;
      await tx.stockMovement.create({
        data: {
          batchId,
          change: input.change,
          reason: input.reason,
          note,
          actorId: context.actorId ?? null,
        },
        select: { id: true },
      });
      const updated = await tx.stockBatch.findUniqueOrThrow({
        where: { id: batchId },
        select: BATCH_FIELDS,
      });
      await this.audit.record(tx, {
        ...context,
        action: 'stock.changed',
        targetType: 'batch',
        targetId: batchId,
        before: { quantity: current.quantity },
        after: {
          quantity: updated.quantity,
          change: input.change,
          reason: input.reason,
          note,
        },
      });
      return updated;
    });
    this.logger.info(
      { batchId, actorId: context.actorId, reason: input.reason },
      'Stock changed',
    );
    return staffView(batch, await this.holdsOfBatch(batchId), now);
  }

  // Puts right a batch's stock from a count of its shelf (ADR 0034). Staff
  // send what they counted, and what the console said should be there: the
  // free packs and those waiting to be packed. If that changed meanwhile,
  // an order took or gave back packs while they counted, and nothing is
  // saved. Otherwise the difference becomes a correction, with its note.
  async count(
    batchId: string,
    input: CountInput,
    context: AuditContext,
  ): Promise<{ batch: StaffBatch; change: number }> {
    const now = new Date();
    const counted = await this.prisma.$transaction(async (tx) => {
      // Locked first: an order takes or gives back packs only after it.
      const current = await this.lockedBatch(tx, batchId);
      const holds = (await holdsOf(tx, [batchId])).get(batchId) ?? NO_HOLDS;
      const onShelf = current.quantity + holds.awaitingPacking;
      if (onShelf !== input.onShelf) {
        throw new ConflictException(COUNT_CHANGED);
      }
      const change = input.counted - onShelf;
      if (change === 0) {
        return { batch: current, holds, change };
      }
      const note = input.note ?? null;
      if (!note) {
        throw validationFailed([{ field: 'note', message: COUNT_NEEDS_NOTE }]);
      }
      // Fewer on the shelf than the orders still to pack need: the count or
      // the orders are wrong, and staff must find out which.
      if (current.quantity + change < 0) {
        throw new ConflictException(fewerThanOrdersNeed(holds.awaitingPacking));
      }
      await tx.stockMovement.create({
        data: {
          batchId,
          change,
          reason: 'CORRECTION',
          note,
          actorId: context.actorId ?? null,
        },
        select: { id: true },
      });
      const updated = await tx.stockBatch.findUniqueOrThrow({
        where: { id: batchId },
        select: BATCH_FIELDS,
      });
      await this.audit.record(tx, {
        ...context,
        action: 'stock.counted',
        targetType: 'batch',
        targetId: batchId,
        before: { quantity: current.quantity, onShelf },
        after: {
          quantity: updated.quantity,
          onShelf: input.counted,
          change,
          note,
        },
      });
      return { batch: updated, holds, change };
    });
    this.logger.info(
      { batchId, actorId: context.actorId, change: counted.change },
      counted.change === 0 ? 'Count matched' : 'Stock counted',
    );
    return {
      batch: staffView(counted.batch, counted.holds, now),
      change: counted.change,
    };
  }

  // A batch's movements, newest first, one page at a time.
  async listMovements(batchId: string, query: MovementListQuery) {
    const batch = await this.prisma.stockBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!batch) {
      throw new NotFoundException(BATCH_NOT_FOUND);
    }
    const rows = await this.prisma.stockMovement.findMany({
      where: { batchId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than asked for, to know whether another page exists.
      take: query.limit + 1,
      // Start at the given movement, but skip it: it was on the last page.
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
      select: MOVEMENT_FIELDS,
    });
    const movements = rows.slice(0, query.limit);
    return {
      movements,
      nextBefore:
        rows.length > query.limit ? movements[movements.length - 1].id : null,
    };
  }

  // For an order (ADR 0026): takes each line's packs from its pack size's
  // sellable batches, the first to expire first, as ORDERED movements in
  // the order's transaction. Throws NotEnoughStockError for the first pack
  // size without enough, and the transaction then takes nothing. The
  // batches are locked in the order of their IDs, so two orders at the
  // same moment take turns instead of waiting for each other forever.
  async take(
    tx: Prisma.TransactionClient,
    orderId: string,
    lines: { variantId: string; packs: number }[],
    now = new Date(),
  ): Promise<void> {
    const candidates = await tx.stockBatch.findMany({
      where: {
        variantId: { in: lines.map((line) => line.variantId) },
        quantity: { gt: 0 },
        expiresOn: { gte: sellableFrom(now) },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    for (const { id } of candidates) {
      await this.lockBatch(tx, id);
    }
    // Read again once locked: another order may have taken some meanwhile.
    const batches = await tx.stockBatch.findMany({
      where: { id: { in: candidates.map((batch) => batch.id) } },
      orderBy: BATCH_ORDER,
      select: { id: true, variantId: true, quantity: true },
    });
    const movements: Prisma.StockMovementCreateManyInput[] = [];
    for (const line of lines) {
      let needed = line.packs;
      for (const batch of batches) {
        if (needed === 0) {
          break;
        }
        if (batch.variantId !== line.variantId || batch.quantity === 0) {
          continue;
        }
        const taken = Math.min(needed, batch.quantity);
        movements.push({
          batchId: batch.id,
          change: -taken,
          reason: 'ORDERED',
          orderId,
        });
        needed -= taken;
      }
      if (needed > 0) {
        throw new NotEnoughStockError(line.variantId);
      }
    }
    await tx.stockMovement.createMany({ data: movements });
  }

  // For an order that was cancelled or expired (ADR 0026): gives back to
  // each batch what the order still holds of it, as RELEASED movements in
  // the order's transaction, in the order of the batches' IDs, the same
  // order in which take locks them. A batch deleted meanwhile took the
  // order's movements along, and gets nothing back.
  async release(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const held = await tx.stockMovement.groupBy({
      by: ['batchId'],
      where: { orderId },
      _sum: { change: true },
      orderBy: { batchId: 'asc' },
    });
    const movements: Prisma.StockMovementCreateManyInput[] = held
      .filter((batch) => (batch._sum.change ?? 0) < 0)
      .map((batch) => ({
        batchId: batch.batchId,
        change: -(batch._sum.change ?? 0),
        reason: 'RELEASED',
        orderId,
      }));
    if (movements.length > 0) {
      await tx.stockMovement.createMany({ data: movements });
    }
  }

  // What orders hold of one batch, read after a change to it is saved.
  private async holdsOfBatch(batchId: string): Promise<Holds> {
    return (await holdsOf(this.prisma, [batchId])).get(batchId) ?? NO_HOLDS;
  }

  // Locks one batch until the transaction ends, or answers false when
  // there is no such batch. The ID is sent as a parameter, never pasted
  // into the SQL.
  private async lockBatch(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM stock_batches WHERE id = ${id}::uuid FOR UPDATE`;
    return locked.length > 0;
  }

  // Locks the batch until the transaction ends, then reads it, or answers
  // 404. One change at a time for each batch, so a check and an audit
  // entry's "before" see it as it really is.
  private async lockedBatch(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<BatchRow> {
    if (!(await this.lockBatch(tx, id))) {
      throw new NotFoundException(BATCH_NOT_FOUND);
    }
    return tx.stockBatch.findUniqueOrThrow({
      where: { id },
      select: BATCH_FIELDS,
    });
  }

  // The database decides what Prisma reports as an error: a batch number
  // the pack size already has (409), or a pack size that does not exist
  // (404).
  private async saving<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(BATCH_NUMBER_TAKEN);
      }
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException(PACK_NOT_FOUND);
      }
      throw error;
    }
  }
}

function labelOf(batch: {
  batchNumber: string;
  manufacturedOn: Date;
  expiresOn: Date;
}): BatchLabel {
  return {
    batchNumber: batch.batchNumber,
    manufacturedOn: labelDay(batch.manufacturedOn),
    expiresOn: labelDay(batch.expiresOn),
  };
}

function only(label: BatchLabel, fields: (keyof BatchLabel)[]) {
  return Object.fromEntries(fields.map((field) => [field, label[field]]));
}

function staffView(batch: BatchRow, holds: Holds, now: Date): StaffBatch {
  return {
    ...batch,
    manufacturedOn: labelDay(batch.manufacturedOn),
    expiresOn: labelDay(batch.expiresOn),
    sellable: isSellable(batch.expiresOn, now),
    stopsSellingOn: labelDay(stopsSellingOn(batch.expiresOn)),
    awaitingPacking: holds.awaitingPacking,
    packed: holds.packed,
    onShelf: batch.quantity + holds.awaitingPacking,
  };
}
