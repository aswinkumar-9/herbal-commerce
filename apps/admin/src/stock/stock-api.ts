import { z } from 'zod';
import { apiRequest } from '../api/client';
import { PACK_UNITS, idInPath } from '../catalog/catalog-api';

// The staff stock API (ADR 0024, 0034 for the Stock page and counts): what
// the console reads and sends about pack sizes' batches and their stock.
// Every answer is checked against these shapes.

const STOCK = '/v1/staff/stock';
const VARIANTS = '/v1/staff/variants';
const BATCHES = '/v1/staff/batches';

// A date as on a label: 2028-09-30.
const labelDay = z.iso.date();
const packs = z.number().int();

// Out of stock: nothing that may be sold. Low: at the pack size's own
// number of packs or fewer.
export const STOCK_LEVELS = ['OUT', 'LOW', 'OK'] as const;
export type StockLevel = (typeof STOCK_LEVELS)[number];

// A pack size's stock, summed over its batches.
export const stockSummarySchema = z.object({
  // Free to sell, in every batch.
  free: packs,
  // Free to sell, in the batches that may be sold today.
  sellable: packs,
  // Taken by orders not yet packed: still on the shelf.
  awaitingPacking: packs,
  // Taken by orders packed but not shipped: in their boxes.
  packed: packs,
  level: z.enum(STOCK_LEVELS),
  // The next day a batch that sells today and holds stock stops selling.
  stopsSellingOn: labelDay.nullable(),
  // Whether that day is within 30 days.
  expiringSoon: z.boolean(),
});
export type StockSummary = z.infer<typeof stockSummarySchema>;

// One pack size with its stock, as the Stock page lists it. Drafts and
// pack sizes off sale are listed too.
export const stockLineSchema = z.object({
  variant: z.object({
    id: z.string(),
    sku: z.string(),
    quantity: z.number().int(),
    unit: z.enum(PACK_UNITS),
    isActive: z.boolean(),
    lowStockAt: z.number().int(),
    position: z.number().int(),
  }),
  product: z.object({
    id: z.string(),
    name: z.string(),
    isActive: z.boolean(),
  }),
  stock: stockSummarySchema,
});
export type StockLine = z.infer<typeof stockLineSchema>;
const stockPageSchema = z.object({
  lines: z.array(stockLineSchema),
  nextAfter: z.string().nullable(),
});
export type StockPage = z.infer<typeof stockPageSchema>;

// One batch: its label, the packs free to sell, whether it may be sold
// today and from when it no longer may, and the packs orders took but have
// not shipped. onShelf is what a count of its shelf should find: the free
// packs and those waiting to be packed.
export const batchSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  batchNumber: z.string(),
  manufacturedOn: labelDay,
  expiresOn: labelDay,
  quantity: packs,
  sellable: z.boolean(),
  stopsSellingOn: labelDay,
  awaitingPacking: packs,
  packed: packs,
  onShelf: packs,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Batch = z.infer<typeof batchSchema>;

// A pack size's batches, the first to expire first, with the pack size and
// its stock summed up.
const batchListSchema = stockLineSchema.extend({
  batches: z.array(batchSchema),
});
export type BatchList = z.infer<typeof batchListSchema>;

// Why a batch's stock changed. Staff choose the first four; orders write
// the others.
export const STOCK_REASONS = [
  'RECEIVED',
  'DAMAGED',
  'EXPIRED',
  'CORRECTION',
  'ORDERED',
  'RELEASED',
] as const;
export type StockReason = (typeof STOCK_REASONS)[number];
export type StaffReason = Exclude<StockReason, 'ORDERED' | 'RELEASED'>;

export const movementSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  // More (positive) or fewer (negative) packs.
  change: z.number().int(),
  reason: z.enum(STOCK_REASONS),
  note: z.string().nullable(),
  // The staff member who made it; none for an order's.
  actorId: z.string().nullable(),
  createdAt: z.string(),
});
export type Movement = z.infer<typeof movementSchema>;
const movementPageSchema = z.object({
  movements: z.array(movementSchema),
  nextBefore: z.string().nullable(),
});
export type MovementPage = z.infer<typeof movementPageSchema>;

// A count's answer: the batch now, and how many packs it put right (0 when
// the count matched and nothing was saved).
const countResultSchema = z.object({
  batch: batchSchema,
  change: z.number().int(),
});
export type CountResult = z.infer<typeof countResultSchema>;

// The Stock page's filters: out of stock, low or out, or a batch that stops
// selling within 30 days.
export const STOCK_FILTERS = ['out', 'low', 'expiring'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export interface StockQuery {
  status?: StockFilter | undefined;
  productId?: string | undefined;
  // Words in the product's name or the SKU.
  q?: string | undefined;
  after?: string | undefined;
  limit?: number | undefined;
}

// A delivery, as its label says: dates like 2028-09-30, and how many packs
// came. An empty note is none.
export interface BatchFields {
  batchNumber: string;
  manufacturedOn: string;
  expiresOn: string;
  quantity: number;
  note?: string | null;
}
// A correction of a batch's label. Its stock changes only by movements.
export type BatchLabel = Partial<
  Pick<BatchFields, 'batchNumber' | 'manufacturedOn' | 'expiresOn'>
>;
// More of a batch received (positive), a write-off (negative), or a
// correction either way, which must say why.
export interface MovementFields {
  change: number;
  reason: StaffReason;
  note?: string | null;
}
// What staff counted on the shelf, and what the console showed should be
// there when they started. A count that differs must say why.
export interface CountFields {
  counted: number;
  onShelf: number;
  note?: string | null;
}

// One page of pack sizes with their stock, by product name, then in each
// product's order.
export function listStock(query: StockQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.productId) {
    params.set('productId', query.productId);
  }
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.after) {
    params.set('after', query.after);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  const search = params.toString();
  return apiRequest(search ? `${STOCK}?${search}` : STOCK, {
    schema: stockPageSchema,
    signal,
  });
}

// Every pack size of one product with its stock, however many pages.
export async function listProductStock(
  productId: string,
  signal?: AbortSignal,
) {
  const lines: StockLine[] = [];
  let after: string | undefined;
  do {
    const page = await listStock({ productId, after, limit: 100 }, signal);
    lines.push(...page.lines);
    after = page.nextAfter ?? undefined;
  } while (after);
  return lines;
}

export async function listBatches(variantId: string, signal?: AbortSignal) {
  return apiRequest(`${idInPath(VARIANTS, variantId)}/batches`, {
    schema: batchListSchema,
    signal,
  });
}

// A delivery of the pack size: a new batch with its packs.
export async function receiveBatch(variantId: string, input: BatchFields) {
  return apiRequest(`${idInPath(VARIANTS, variantId)}/batches`, {
    method: 'POST',
    body: input,
    schema: batchSchema,
  });
}

export async function updateBatch(id: string, changes: BatchLabel) {
  return apiRequest(idInPath(BATCHES, id), {
    method: 'PATCH',
    body: changes,
    schema: batchSchema,
  });
}

// A batch's movements, newest first, a page at a time: each page's
// nextBefore asks for the next.
export async function listMovements(
  batchId: string,
  query: { before?: string | undefined; limit?: number | undefined } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (query.before) {
    params.set('before', query.before);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  const search = params.toString();
  const path = `${idInPath(BATCHES, batchId)}/movements`;
  return apiRequest(search ? `${path}?${search}` : path, {
    schema: movementPageSchema,
    signal,
  });
}

export async function addMovement(batchId: string, input: MovementFields) {
  return apiRequest(`${idInPath(BATCHES, batchId)}/movements`, {
    method: 'POST',
    body: input,
    schema: batchSchema,
  });
}

// Puts a batch's stock right from a count of its shelf. The API refuses
// (409) if an order took or gave back packs of it meanwhile.
export async function countBatch(batchId: string, input: CountFields) {
  return apiRequest(`${idInPath(BATCHES, batchId)}/count`, {
    method: 'POST',
    body: input,
    schema: countResultSchema,
  });
}
