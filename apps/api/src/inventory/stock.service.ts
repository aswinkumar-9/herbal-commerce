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
  batchDateIssues,
  expiredIssues,
  isSellable,
  sellableFrom,
} from './stock-rules';
import type {
  BatchInput,
  BatchUpdateInput,
  MovementInput,
  MovementListQuery,
} from './stock.schemas';

export const PACK_NOT_FOUND = 'Pack size not found';
export const BATCH_NOT_FOUND = 'Batch not found';
export const BATCH_NUMBER_TAKEN =
  'This pack size already has a batch with this number.';
export const notEnoughStock = (held: number) =>
  `Not enough stock: this batch holds ${held}.`;

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
// and whether it may be sold today.
export type StaffBatch = Omit<BatchRow, 'manufacturedOn' | 'expiresOn'> & {
  manufacturedOn: string;
  expiresOn: string;
  sellable: boolean;
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

  // Every batch of a pack size, the first to expire first, with how many
  // packs are on hand and how many of them may be sold today.
  async listBatches(variantId: string): Promise<{
    batches: StaffBatch[];
    quantity: number;
    sellableQuantity: number;
  }> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { batches: { orderBy: BATCH_ORDER, select: BATCH_FIELDS } },
    });
    if (!variant) {
      throw new NotFoundException(PACK_NOT_FOUND);
    }
    const now = new Date();
    const batches = variant.batches.map((batch) => staffView(batch, now));
    return {
      batches,
      quantity: total(batches),
      sellableQuantity: total(batches.filter((batch) => batch.sellable)),
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
    return staffView(batch, now);
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
    return staffView(batch, now);
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
    return staffView(batch, now);
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

  // Locks the batch until the transaction ends, then reads it, or answers
  // 404. One change at a time for each batch, so a check and an audit
  // entry's "before" see it as it really is. The ID is sent as a
  // parameter, never pasted into the SQL.
  private async lockedBatch(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<BatchRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM stock_batches WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) {
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

// A date as on a label: 2028-09-30.
function labelDay(date: Date): string {
  return date.toISOString().slice(0, 10);
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

function staffView(batch: BatchRow, now: Date): StaffBatch {
  return {
    ...batch,
    manufacturedOn: labelDay(batch.manufacturedOn),
    expiresOn: labelDay(batch.expiresOn),
    sellable: isSellable(batch.expiresOn, now),
  };
}

function total(batches: { quantity: number }[]): number {
  return batches.reduce((sum, batch) => sum + batch.quantity, 0);
}
