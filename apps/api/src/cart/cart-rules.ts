// The cart's rules (ADR 0025). The database holds the same two limits, in
// the trigger cart_items_limits.

// At most 4 packs of one product in a cart, all its pack sizes together.
export const MAX_PACKS_PER_PRODUCT = 4;
// At most 50 pack sizes in a cart: a guard, so that no cart grows without
// end.
export const MAX_CART_LINES = 50;

export const OUT_OF_STOCK = 'This pack size is out of stock.';
export const CART_FULL = `A cart holds at most ${MAX_CART_LINES} pack sizes. Remove one first.`;
export const tooManyOfProduct = (otherPacks: number) =>
  `At most ${MAX_PACKS_PER_PRODUCT} packs of one product, all its pack sizes together. The cart already has ${otherPacks} in other sizes.`;

// A change to one pack size in a cart: how many packs it should hold, and
// what the cart holds now.
export interface PacksChange {
  // How many packs the customer wants.
  packs: number;
  // How many the cart holds now: 0 while the pack size is not in it.
  currentPacks: number;
  // How many packs of the same product the cart holds in its other sizes.
  otherPacks: number;
  // How many pack sizes the cart holds.
  lines: number;
  // Whether the pack size can be bought today.
  inStock: boolean;
}

// Why the cart cannot hold this many packs, or null when it can. Fewer
// packs are always fine: only adding needs stock and room.
export function packsRefusal(change: PacksChange): string | null {
  if (change.packs <= change.currentPacks) {
    return null;
  }
  if (!change.inStock) {
    return OUT_OF_STOCK;
  }
  if (change.packs + change.otherPacks > MAX_PACKS_PER_PRODUCT) {
    return tooManyOfProduct(change.otherPacks);
  }
  if (change.currentPacks === 0 && change.lines >= MAX_CART_LINES) {
    return CART_FULL;
  }
  return null;
}

// Whether a line can be bought now: on sale and in stock, out of stock, or
// no longer sold (taken off sale, or its product or category hidden).
export type LineStatus = 'AVAILABLE' | 'OUT_OF_STOCK' | 'OFF_SALE';

export function lineStatus(onSale: boolean, inStock: boolean): LineStatus {
  if (!onSale) {
    return 'OFF_SALE';
  }
  return inStock ? 'AVAILABLE' : 'OUT_OF_STOCK';
}

// What the lines that can be bought now come to: how many packs, their
// price today and their MRP, in whole rupees. The other lines stay in the
// cart, but count for nothing.
export function cartTotals(
  lines: {
    packs: number;
    priceRupees: number;
    mrpRupees: number;
    status: LineStatus;
  }[],
): { packs: number; subtotalRupees: number; mrpTotalRupees: number } {
  let packs = 0;
  let subtotalRupees = 0;
  let mrpTotalRupees = 0;
  for (const line of lines) {
    if (line.status === 'AVAILABLE') {
      packs += line.packs;
      subtotalRupees += line.packs * line.priceRupees;
      mrpTotalRupees += line.packs * line.mrpRupees;
    }
  }
  return { packs, subtotalRupees, mrpTotalRupees };
}
