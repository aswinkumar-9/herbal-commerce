import type { Prisma } from '../generated/prisma/client';
import type { OrderStatus } from '../generated/prisma/enums';
import {
  isExpiringSoon,
  isSellable,
  stockLevel,
  stopsSellingOn,
} from './stock-rules';
import type { StockLevel } from './stock-rules';

// What a pack size's stock looks like to staff (ADR 0034): the packs free
// to sell, the packs orders took but have not shipped, and what needs doing.

// The orders whose packs are still on the shelf: waiting for payment, or
// paid and waiting to be packed. A packed order's packs are in its box.
const AWAITING_PACKING: OrderStatus[] = ['PENDING_PAYMENT', 'PAID'];
const PACKED: OrderStatus[] = ['PACKED'];

// The packs of one batch that orders took and have not shipped yet.
export interface Holds {
  awaitingPacking: number;
  packed: number;
}

export const NO_HOLDS: Holds = { awaitingPacking: 0, packed: 0 };

type MovementReader = Pick<Prisma.TransactionClient, 'stockMovement'>;

// How many packs of each batch orders took and have not shipped. An order's
// movements on a batch add up to what it holds of it: taken, and taken
// again after a late payment, less what it gave back.
export async function holdsOf(
  db: MovementReader,
  batchIds: string[],
): Promise<Map<string, Holds>> {
  const holds = new Map<string, Holds>();
  if (batchIds.length === 0) {
    return holds;
  }
  const awaiting = await heldBy(db, batchIds, AWAITING_PACKING);
  const packed = await heldBy(db, batchIds, PACKED);
  for (const id of new Set([...awaiting.keys(), ...packed.keys()])) {
    holds.set(id, {
      awaitingPacking: awaiting.get(id) ?? 0,
      packed: packed.get(id) ?? 0,
    });
  }
  return holds;
}

async function heldBy(
  db: MovementReader,
  batchIds: string[],
  statuses: OrderStatus[],
): Promise<Map<string, number>> {
  const rows = await db.stockMovement.groupBy({
    by: ['batchId'],
    where: {
      batchId: { in: batchIds },
      order: { is: { status: { in: statuses } } },
    },
    _sum: { change: true },
  });
  return new Map(
    rows.map((row) => [row.batchId, Math.max(0, -(row._sum.change ?? 0))]),
  );
}

// A pack size's stock, summed over its batches.
export interface StockSummary {
  // Free to sell, in every batch.
  free: number;
  // Free to sell, in the batches that may be sold today.
  sellable: number;
  awaitingPacking: number;
  packed: number;
  level: StockLevel;
  // The next day a batch that sells today and holds stock stops selling.
  stopsSellingOn: string | null;
  // Whether that day is within EXPIRING_SOON_DAYS.
  expiringSoon: boolean;
}

export function summarise(
  batches: { expiresOn: Date; quantity: number; holds: Holds }[],
  lowStockAt: number,
  now: Date,
): StockSummary {
  let free = 0;
  let sellable = 0;
  let awaitingPacking = 0;
  let packed = 0;
  let next: Date | null = null;
  let expiringSoon = false;
  for (const batch of batches) {
    free += batch.quantity;
    awaitingPacking += batch.holds.awaitingPacking;
    packed += batch.holds.packed;
    if (!isSellable(batch.expiresOn, now)) {
      continue;
    }
    sellable += batch.quantity;
    if (batch.quantity === 0) {
      continue;
    }
    const stops = stopsSellingOn(batch.expiresOn);
    if (!next || stops.getTime() < next.getTime()) {
      next = stops;
    }
    expiringSoon ||= isExpiringSoon(batch.expiresOn, now);
  }
  return {
    free,
    sellable,
    awaitingPacking,
    packed,
    level: stockLevel(sellable, lowStockAt),
    stopsSellingOn: next ? labelDay(next) : null,
    expiringSoon,
  };
}

// A date as on a label: 2028-09-30.
export function labelDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// What staff see of a pack size next to its stock.
export const LINE_FIELDS = {
  id: true,
  sku: true,
  quantity: true,
  unit: true,
  isActive: true,
  lowStockAt: true,
  position: true,
  product: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.ProductVariantSelect;

export type LineVariant = Prisma.ProductVariantGetPayload<{
  select: typeof LINE_FIELDS;
}>;

// One pack size with its stock, as the Stock page lists it.
export interface StockLine {
  variant: Omit<LineVariant, 'product'>;
  product: LineVariant['product'];
  stock: StockSummary;
}

export function stockLine(
  { product, ...variant }: LineVariant,
  stock: StockSummary,
): StockLine {
  return { variant, product, stock };
}
