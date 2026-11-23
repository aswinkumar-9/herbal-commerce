// Checkout and the customer's orders, from the API (docs/api-specification.md,
// "Checkout and orders"; ADR 0026). The API prices every order; the website
// only shows what it says and sends back the total it showed.
import type { RouterContextProvider } from 'react-router';
import { z } from 'zod';
import { askAsCustomer } from './account.server.ts';
import { segment } from './api.server.ts';
import { PACK_UNITS } from './catalog.server.ts';

type Context = Readonly<RouterContextProvider>;

// An order's ID, and the key that makes placing it once: UUIDs, checked
// before they go into the API's address or headers.
export const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const rupees = z.number().int().min(0);
const lineFields = {
  sku: z.string().min(1).max(40),
  productName: z.string().min(1).max(200),
  quantity: z.number().int().min(1),
  unit: z.enum(PACK_UNITS),
  packs: z.number().int().min(1).max(4),
  mrpRupees: rupees,
  priceRupees: rupees,
  lineTotalRupees: rupees,
  gstRate: z.number().min(0).max(100),
  gstRupees: rupees,
};

export const checkoutSchema = z.object({
  items: z.array(z.object(lineFields)).min(1).max(50),
  itemsTotalRupees: rupees,
  itemsGstRupees: rupees,
  deliveryChargeRupees: rupees,
  totalRupees: z.number().int().min(1),
});
export type Checkout = z.infer<typeof checkoutSchema>;

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const when = z.iso.datetime();
export const orderSchema = z.object({
  id: z.string().regex(UUID),
  // 10 letters and digits, without I, O, 0 or 1.
  reference: z.string().regex(/^[A-HJ-NP-Z2-9]{10}$/),
  status: z.enum(ORDER_STATUSES),
  holdExpiresAt: when,
  createdAt: when,
  packedAt: when.nullable(),
  shippedAt: when.nullable(),
  courierName: z.string().max(100).nullable(),
  trackingNumber: z.string().max(100).nullable(),
  deliveredAt: when.nullable(),
  itemsTotalRupees: rupees,
  itemsGstRupees: rupees,
  deliveryChargeRupees: rupees,
  totalRupees: rupees,
  items: z.array(z.object(lineFields)).min(1).max(50),
  delivery: z.object({
    fullName: z.string().max(100),
    phone: z.string().max(20),
    line1: z.string().max(200),
    line2: z.string().max(200).nullable(),
    city: z.string().max(100),
    state: z.string().max(60),
    pincode: z.string().max(10),
  }),
  payment: z
    .object({
      paidAt: when.nullable(),
      refunds: z.array(
        z.object({
          amountRupees: rupees,
          reason: z.string().max(40),
          status: z.string().max(20),
          createdAt: when,
        }),
      ),
    })
    .nullable(),
});
export type Order = z.infer<typeof orderSchema>;

// The API's words for why the cart can't be ordered, as it says them
// (apps/api/src/orders/order-rules.ts; a test compares them).
export const API_CART_EMPTY = 'The cart is empty.';
export const API_TOTAL_CHANGED =
  'The total has changed. Check the cart and try again.';
export const API_TOO_MANY_OPEN =
  'You have 3 orders waiting for payment. Pay for one or cancel it first.';
export const API_NOT_READY = "These packs can't be ordered now: ";
export const API_NOT_ENOUGH =
  ' is out of stock, or not enough of it is left. Change it in the cart and try again.';

export type NotOrderable =
  'empty' | 'unavailable' | 'changed' | 'tooMany' | 'stock';

// Which of the API's refusals (409) this is.
export function notOrderable(message: string | undefined): NotOrderable {
  if (message === API_CART_EMPTY) {
    return 'empty';
  }
  if (message === API_TOO_MANY_OPEN) {
    return 'tooMany';
  }
  if (message?.startsWith(API_NOT_READY)) {
    return 'unavailable';
  }
  if (message?.endsWith(API_NOT_ENOUGH)) {
    return 'stock';
  }
  return 'changed';
}

// What the cart would cost as an order now, or why it can't be ordered.
export async function readCheckout(request: Request, context: Context) {
  return askAsCustomer(
    request,
    context,
    { method: 'GET', path: 'me/checkout' },
    checkoutSchema,
  );
}

// Places an order from the whole cart. The key makes it once: a second
// tap, or a form sent again, answers the order the first one placed.
export async function placeOrder(
  request: Request,
  context: Context,
  {
    addressId,
    totalRupees,
    key,
  }: { addressId: string; totalRupees: number; key: string },
) {
  return askAsCustomer(
    request,
    context,
    {
      method: 'POST',
      path: 'me/orders',
      body: { addressId, totalRupees },
      idempotencyKey: key,
    },
    orderSchema,
  );
}

export async function readOrder(
  request: Request,
  context: Context,
  id: string,
) {
  return askAsCustomer(
    request,
    context,
    { method: 'GET', path: `me/orders/${segment(id)}` },
    orderSchema,
  );
}

// A time as the customer reads it, in India: 3:12 pm.
const TIME_IN_INDIA = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});
export const timeInIndia = (iso: string): string =>
  TIME_IN_INDIA.format(new Date(iso));
