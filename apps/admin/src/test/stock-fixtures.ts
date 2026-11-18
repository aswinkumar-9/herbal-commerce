import { ML_100, ML_200, ML_500, SHAMPOO } from './catalog-fixtures';
import { json } from './fake-api';

// Stock as the staff stock API answers it (ADR 0034), for the live
// shampoo's pack sizes.

const at = '2026-11-01T09:00:00.000Z';

type Pack = typeof ML_100;

const lineVariant = (pack: Pack) => ({
  id: pack.id,
  sku: pack.sku,
  quantity: pack.quantity,
  unit: pack.unit,
  isActive: pack.isActive,
  lowStockAt: pack.lowStockAt,
  position: pack.position,
});

const shampoo = {
  id: SHAMPOO.id,
  name: SHAMPOO.name,
  isActive: SHAMPOO.isActive,
};

export const PLENTY = {
  free: 40,
  sellable: 40,
  awaitingPacking: 2,
  packed: 1,
  level: 'OK',
  stopsSellingOn: '2028-04-01',
  expiringSoon: false,
};

export const LOW = {
  ...PLENTY,
  free: 4,
  sellable: 4,
  awaitingPacking: 0,
  packed: 0,
  level: 'LOW',
  stopsSellingOn: '2026-12-01',
  expiringSoon: true,
};

export const OUT = {
  free: 0,
  sellable: 0,
  awaitingPacking: 0,
  packed: 0,
  level: 'OUT',
  stopsSellingOn: null,
  expiringSoon: false,
};

export function stockLine(pack: Pack, stock: object = PLENTY) {
  return { variant: lineVariant(pack), product: shampoo, stock };
}

export const LINES = [
  stockLine(ML_100),
  stockLine(ML_200, LOW),
  stockLine(ML_500, OUT),
];

// Two batches of the 100 ml pack: one that stops selling soon, and one
// with orders waiting.
export const SOON = {
  id: '1f2a3b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c',
  variantId: ML_100.id,
  batchNumber: 'AS2511',
  manufacturedOn: '2025-11-01',
  expiresOn: '2027-06-01',
  quantity: 10,
  sellable: true,
  stopsSellingOn: '2026-12-02',
  awaitingPacking: 0,
  packed: 0,
  onShelf: 10,
  createdAt: at,
  updatedAt: at,
};

export const LATER = {
  ...SOON,
  id: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
  batchNumber: 'AS2610',
  manufacturedOn: '2026-10-01',
  expiresOn: '2028-09-30',
  quantity: 30,
  stopsSellingOn: '2028-04-01',
  awaitingPacking: 2,
  packed: 1,
  onShelf: 32,
};

export const batchesOf =
  (pack: Pack, batches: object[], stock = PLENTY) =>
  () =>
    json(200, { ...stockLine(pack, stock), batches });

export const MOVEMENT = {
  id: '3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e',
  batchId: LATER.id,
  change: 30,
  reason: 'RECEIVED',
  note: null,
  actorId: 'staff-1',
  createdAt: at,
};

export const BATCHES = (pack: { id: string }) =>
  `GET /v1/staff/variants/${pack.id}/batches`;
export const MOVEMENTS = (batch: { id: string }) =>
  `GET /v1/staff/batches/${batch.id}/movements`;
