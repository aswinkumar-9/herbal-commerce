import { randomBytes } from 'node:crypto';

// The rules of an order (ADR 0026). Money is in whole paise: 49_900 is
// Rs 499.

// An unpaid order holds its stock for 15 minutes, then expires.
export const HOLD_MINUTES = 15;
// Delivery is free from Rs 499; below that it costs Rs 49.
export const FREE_DELIVERY_FROM_PAISE = 49_900;
export const DELIVERY_CHARGE_PAISE = 4_900;
// A customer has at most 3 orders waiting for payment at once, so nobody
// can hold the shop's stock with many unpaid orders.
export const MAX_OPEN_ORDERS = 3;

export const CART_EMPTY = 'The cart is empty.';
export const NOT_CANCELLABLE =
  'Only an order waiting for payment can be cancelled.';
export const TOO_MANY_OPEN = `You have ${MAX_OPEN_ORDERS} orders waiting for payment. Pay for one or cancel it first.`;
export const TOTAL_CHANGED =
  'The total has changed. Check the cart and try again.';
export const notReady = (skus: string[]) =>
  `These packs can't be ordered now: ${skus.join(', ')}. Change or remove them first.`;
export const notEnoughStock = (sku: string) =>
  `${sku} is out of stock, or not enough of it is left. Change it in the cart and try again.`;

// A price in whole rupees, as the catalog keeps it, in paise.
export function rupeesToPaise(rupees: number): number {
  return rupees * 100;
}

// The delivery charge for items worth this much.
export function deliveryChargePaise(itemsTotalPaise: number): number {
  return itemsTotalPaise >= FREE_DELIVERY_FROM_PAISE
    ? 0
    : DELIVERY_CHARGE_PAISE;
}

// The GST inside an amount that includes it, rounded to the paisa: at 5%,
// Rs 449 holds Rs 21.38. A chartered accountant confirms the rounding with
// the invoices.
export function gstInsidePaise(amountPaise: number, gstRate: number): number {
  return Math.round((amountPaise * gstRate) / (100 + gstRate));
}

// A line of an order: how many packs, at what price and GST rate.
export interface PricedLine {
  pricePaise: number;
  packs: number;
  gstRate: number;
}

// A line's total, and the GST inside it.
export function lineAmounts(line: PricedLine): {
  lineTotalPaise: number;
  gstPaise: number;
} {
  const lineTotalPaise = line.pricePaise * line.packs;
  return {
    lineTotalPaise,
    gstPaise: gstInsidePaise(lineTotalPaise, line.gstRate),
  };
}

// What an order comes to. The GST of the items is the sum of each line's,
// as an invoice shows it line by line.
export function orderTotals(lines: PricedLine[]): {
  itemsTotalPaise: number;
  itemsGstPaise: number;
  deliveryChargePaise: number;
  totalPaise: number;
} {
  let itemsTotalPaise = 0;
  let itemsGstPaise = 0;
  for (const line of lines) {
    const amounts = lineAmounts(line);
    itemsTotalPaise += amounts.lineTotalPaise;
    itemsGstPaise += amounts.gstPaise;
  }
  const delivery = deliveryChargePaise(itemsTotalPaise);
  return {
    itemsTotalPaise,
    itemsGstPaise,
    deliveryChargePaise: delivery,
    totalPaise: itemsTotalPaise + delivery,
  };
}

// Until when a new order holds its stock.
export function holdExpiresAt(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);
}

// 32 letters and digits that can't be mistaken for each other: no I, O, 0
// or 1.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERENCE_LENGTH = 10;

// A new order reference, such as "7KQ2M9XDPA": random, so it says nothing
// about how many orders the shop gets. Each byte picks one of the 32
// characters, and 256 is a multiple of 32, so every character is equally
// likely.
export function newOrderReference(
  random: (size: number) => Buffer = randomBytes,
): string {
  return [...random(REFERENCE_LENGTH)]
    .map((byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length])
    .join('');
}
