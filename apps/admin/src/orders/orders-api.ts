import { z } from 'zod';
import { apiRequest } from '../api/client';
import { PACK_UNITS, idInPath } from '../catalog/catalog-api';

// The staff orders API (ADR 0028): every order, one at a time to pack, ship
// and deliver, cancelling for Super Users, and the refunds. Every answer is
// checked against these shapes.

const ORDERS = '/v1/staff/orders';
const REFUNDS = '/v1/staff/refunds';

// Whole rupees only: the shop has no paise anywhere.
const rupees = z.number().int();
const moment = z.iso.datetime();

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

export const REFUND_STATUSES = [
  'REQUESTED',
  'PENDING',
  'PROCESSED',
  'FAILED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

// Why money went back: a payment that couldn't be kept, or a paid order
// cancelled before it shipped.
export const REFUND_REASONS = [
  'ORDER_EXPIRED',
  'ORDER_CANCELLED',
  'ALREADY_PAID',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_STAFF',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

// An order in the list.
export const orderSummarySchema = z.object({
  id: z.string(),
  reference: z.string(),
  status: z.enum(ORDER_STATUSES),
  totalRupees: rupees,
  deliveryName: z.string(),
  deliveryCity: z.string(),
  deliveryState: z.string(),
  createdAt: moment,
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;
const orderPageSchema = z.object({
  orders: z.array(orderSummarySchema),
  nextAfter: z.string().nullable(),
});
export type OrderPage = z.infer<typeof orderPageSchema>;

// A line: what to pick and pack, at the price the customer paid.
export const orderLineSchema = z.object({
  sku: z.string(),
  productName: z.string(),
  quantity: z.number().int(),
  unit: z.enum(PACK_UNITS),
  packs: z.number().int().positive(),
  mrpRupees: rupees,
  priceRupees: rupees,
  lineTotalRupees: rupees,
  gstRate: z.number(),
  gstRupees: rupees,
  hsnCode: z.string(),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const refundSchema = z.object({
  id: z.string(),
  razorpayPaymentId: z.string(),
  // Razorpay's, once Razorpay has taken the refund.
  razorpayRefundId: z.string().nullable(),
  amountRupees: rupees,
  reason: z.enum(REFUND_REASONS),
  status: z.enum(REFUND_STATUSES),
  createdAt: moment,
  updatedAt: moment,
  // A failed refund a Super User gave back another way (ADR 0038): when,
  // how, and who. Null until then, and for every other refund.
  givenBackAt: moment.nullable(),
  givenBackNote: z.string().nullable(),
  givenBackBy: z.object({ id: z.string(), fullName: z.string() }).nullable(),
});
export type Refund = z.infer<typeof refundSchema>;

// Super Users only: the payment, with Razorpay's IDs and every refund, the
// oldest first.
export const paymentSchema = z.object({
  razorpayOrderId: z.string(),
  // The payment that paid the order, once one did.
  razorpayPaymentId: z.string().nullable(),
  amountRupees: rupees,
  paidAt: moment.nullable(),
  createdAt: moment,
  refunds: z.array(refundSchema),
});
export type Payment = z.infer<typeof paymentSchema>;

// An order, to pack and ship it. The customer is named only by the
// delivery address. An Admin's answer has no payment; a Super User's has
// null until paying starts.
export const orderSchema = z.object({
  id: z.string(),
  reference: z.string(),
  status: z.enum(ORDER_STATUSES),
  createdAt: moment,
  // Until when an unpaid order holds its stock.
  holdExpiresAt: moment,
  packedAt: moment.nullable(),
  shippedAt: moment.nullable(),
  courierName: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  deliveredAt: moment.nullable(),
  items: z.array(orderLineSchema).min(1),
  itemsTotalRupees: rupees,
  // The GST inside the items' prices.
  itemsGstRupees: rupees,
  deliveryChargeRupees: rupees,
  totalRupees: rupees,
  delivery: z.object({
    fullName: z.string(),
    phone: z.string(),
    line1: z.string(),
    line2: z.string().nullable(),
    city: z.string(),
    state: z.string(),
    pincode: z.string(),
  }),
  payment: paymentSchema.nullable().optional(),
});
export type Order = z.infer<typeof orderSchema>;

// A refund in the Super Users' list, naming its order by its ID and by the
// reference the customer quotes.
export const listedRefundSchema = refundSchema.extend({
  orderId: z.string(),
  orderReference: z.string(),
});
export type ListedRefund = z.infer<typeof listedRefundSchema>;
const refundPageSchema = z.object({
  refunds: z.array(listedRefundSchema),
  nextAfter: z.string().nullable(),
});
export type RefundPage = z.infer<typeof refundPageSchema>;

// An order's reference, as the API makes them: 10 letters and digits. A
// customer may quote it in small letters, or with spaces.
const REFERENCE = /^[A-Z0-9]{10}$/;

// The reference staff typed, tidied, or undefined if it can't be one.
export function orderReference(typed: string): string | undefined {
  const tidy = typed.replace(/[\s-]+/g, '').toUpperCase();
  return REFERENCE.test(tidy) ? tidy : undefined;
}

export interface OrderQuery {
  status?: OrderStatus | undefined;
  reference?: string | undefined;
  // By when the order was placed; the API's default is newest.
  sort?: 'newest' | 'oldest' | undefined;
  after?: string | undefined;
  limit?: number | undefined;
}

export interface RefundQuery {
  status?: RefundStatus | undefined;
  // false: only the failed ones not given back by hand yet.
  givenBack?: boolean | undefined;
  after?: string | undefined;
  limit?: number | undefined;
}

// What staff type when the courier takes an order. The API tidies both.
export interface ShipmentFields {
  courierName: string;
  trackingNumber: string;
}

function withParams(path: string, params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(name, String(value));
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

// One page of orders: each page's nextAfter asks for the next.
export function listOrders(query: OrderQuery, signal?: AbortSignal) {
  const path = withParams(ORDERS, {
    status: query.status,
    reference: query.reference,
    sort: query.sort,
    after: query.after,
    limit: query.limit,
  });
  return apiRequest(path, { schema: orderPageSchema, signal });
}

// How many paid orders wait to be packed: up to 100 are counted, and more
// says there are more than that.
export async function countToPack(signal?: AbortSignal) {
  const page = await listOrders({ status: 'PAID', limit: 100 }, signal);
  return { count: page.orders.length, more: page.nextAfter !== null };
}

export async function getOrder(id: string, signal?: AbortSignal) {
  return apiRequest(idInPath(ORDERS, id), { schema: orderSchema, signal });
}

async function step(id: string, name: 'packed' | 'delivered' | 'cancel') {
  return apiRequest(`${idInPath(ORDERS, id)}/${name}`, {
    method: 'POST',
    schema: orderSchema,
  });
}

export const markPacked = (id: string) => step(id, 'packed');
export const markDelivered = (id: string) => step(id, 'delivered');
// Super Users only. A paid order's payment goes back in full.
export const cancelOrder = (id: string) => step(id, 'cancel');

export async function markShipped(id: string, shipment: ShipmentFields) {
  return apiRequest(`${idInPath(ORDERS, id)}/shipped`, {
    method: 'POST',
    body: shipment,
    schema: orderSchema,
  });
}

// Corrects a typing mistake while the order is on its way: only what
// changed is sent.
export async function correctShipment(
  id: string,
  changes: Partial<ShipmentFields>,
) {
  return apiRequest(`${idInPath(ORDERS, id)}/shipment`, {
    method: 'PATCH',
    body: changes,
    schema: orderSchema,
  });
}

// Super Users only: every refund, newest first, a page at a time.
export function listRefunds(query: RefundQuery, signal?: AbortSignal) {
  const path = withParams(REFUNDS, {
    status: query.status,
    givenBack: query.givenBack,
    after: query.after,
    limit: query.limit,
  });
  return apiRequest(path, { schema: refundPageSchema, signal });
}

// A failed refund the Super User gave back another way, such as a bank
// transfer, and how (ADR 0038). Once only: the API refuses a second time.
export async function giveBackByHand(id: string, note: string) {
  return apiRequest(`${idInPath(REFUNDS, id)}/given-back`, {
    method: 'POST',
    body: { note },
    schema: listedRefundSchema,
  });
}
