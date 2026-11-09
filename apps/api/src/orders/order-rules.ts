import { randomBytes } from 'node:crypto';

// The rules of an order (ADR 0026). Money is in whole rupees, like the
// catalog's (ADR 0022): the GST too, rounded to the nearest rupee.

// An unpaid order holds its stock for 15 minutes, then expires.
export const HOLD_MINUTES = 15;
// Delivery is free from Rs 499; below that it costs Rs 49.
export const FREE_DELIVERY_FROM_RUPEES = 499;
export const DELIVERY_CHARGE_RUPEES = 49;
// A customer has at most 3 orders waiting for payment at once, so nobody
// can hold the shop's stock with many unpaid orders.
export const MAX_OPEN_ORDERS = 3;

export const CART_EMPTY = 'The cart is empty.';
export const NOT_CANCELLABLE =
  'Only an order waiting for payment can be cancelled.';
export const TOO_MANY_OPEN = `You have ${MAX_OPEN_ORDERS} orders waiting for payment. Pay for one or cancel it first.`;
export const TOTAL_CHANGED =
  'The total has changed. Check the cart and try again.';
export const NOT_PAYABLE = 'Only an order waiting for payment can be paid.';
export const HOLD_OVER =
  'The time to pay for this order is over. Please order again.';
export const PAYMENTS_UNAVAILABLE =
  'Payments are not available right now. Please try again in a minute.';
export const PAYMENT_NOT_STARTED = 'Start paying for this order first.';
export const PAYMENT_NOT_VERIFIED = 'The payment could not be verified.';
export const notReady = (skus: string[]) =>
  `These packs can't be ordered now: ${skus.join(', ')}. Change or remove them first.`;
export const notEnoughStock = (sku: string) =>
  `${sku} is out of stock, or not enough of it is left. Change it in the cart and try again.`;

// The delivery charge for items worth this much.
export function deliveryChargeRupees(itemsTotalRupees: number): number {
  return itemsTotalRupees >= FREE_DELIVERY_FROM_RUPEES
    ? 0
    : DELIVERY_CHARGE_RUPEES;
}

// The GST inside an amount that includes it, rounded to the nearest rupee:
// at 5%, Rs 449 holds Rs 21.38, so Rs 21. A chartered accountant confirms
// this rounding with the invoices.
export function gstInsideRupees(amountRupees: number, gstRate: number): number {
  return Math.round((amountRupees * gstRate) / (100 + gstRate));
}

// A line of an order: how many packs, at what price and GST rate.
export interface PricedLine {
  priceRupees: number;
  packs: number;
  gstRate: number;
}

// A line's total, and the GST inside it.
export function lineAmounts(line: PricedLine): {
  lineTotalRupees: number;
  gstRupees: number;
} {
  const lineTotalRupees = line.priceRupees * line.packs;
  return {
    lineTotalRupees,
    gstRupees: gstInsideRupees(lineTotalRupees, line.gstRate),
  };
}

// What an order comes to. The GST of the items is the sum of each line's,
// as an invoice shows it line by line.
export function orderTotals(lines: PricedLine[]): {
  itemsTotalRupees: number;
  itemsGstRupees: number;
  deliveryChargeRupees: number;
  totalRupees: number;
} {
  let itemsTotalRupees = 0;
  let itemsGstRupees = 0;
  for (const line of lines) {
    const amounts = lineAmounts(line);
    itemsTotalRupees += amounts.lineTotalRupees;
    itemsGstRupees += amounts.gstRupees;
  }
  const delivery = deliveryChargeRupees(itemsTotalRupees);
  return {
    itemsTotalRupees,
    itemsGstRupees,
    deliveryChargeRupees: delivery,
    totalRupees: itemsTotalRupees + delivery,
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

// An order reference as newOrderReference makes it: what staff look an
// order up by when a customer quotes it.
export const ORDER_REFERENCE = new RegExp(
  `^[${REFERENCE_ALPHABET}]{${REFERENCE_LENGTH}}$`,
);
