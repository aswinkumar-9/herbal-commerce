import { json } from './fake-api';

// Orders as the staff orders API answers them (ADR 0028). Each is as a
// Super User sees it, with its payment; forAdmin takes the payment away.

const placed = '2026-11-09T05:10:12.408Z';

export const LINE = {
  sku: 'ASH-CAP-60',
  productName: 'Ashwagandha Capsules',
  quantity: 60,
  unit: 'CAPSULES',
  packs: 1,
  mrpRupees: 500,
  priceRupees: 449,
  lineTotalRupees: 449,
  gstRate: 5,
  gstRupees: 21,
  hsnCode: '300490',
};

export const SHAMPOO_LINE = {
  sku: 'AML-SHA-100',
  productName: 'Amla Shampoo',
  quantity: 100,
  unit: 'ML',
  packs: 2,
  mrpRupees: 260,
  priceRupees: 240,
  lineTotalRupees: 480,
  gstRate: 18,
  gstRupees: 73,
  hsnCode: '330510',
};

const payment = (amountRupees: number) => ({
  razorpayOrderId: 'order_RB58MiP5SPFYyM',
  razorpayPaymentId: 'pay_G3P9vcIhRs3NV4' as string | null,
  amountRupees,
  paidAt: '2026-11-09T05:12:30.514Z' as string | null,
  createdAt: '2026-11-09T05:11:02.233Z',
  refunds: [] as object[],
});

export const PAID = {
  id: '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30',
  reference: '7KQ2M9XDPA',
  status: 'PAID',
  createdAt: placed,
  holdExpiresAt: '2026-11-09T05:25:12.408Z',
  packedAt: null as string | null,
  shippedAt: null as string | null,
  courierName: null as string | null,
  trackingNumber: null as string | null,
  deliveredAt: null as string | null,
  items: [LINE, SHAMPOO_LINE],
  itemsTotalRupees: 929,
  itemsGstRupees: 94,
  deliveryChargeRupees: 0,
  totalRupees: 929,
  delivery: {
    fullName: 'Asha K',
    phone: '9845012345',
    line1: '12, 3rd Cross, Indiranagar',
    line2: null as string | null,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560038',
  },
  payment: payment(929) as ReturnType<typeof payment> | null,
};

// A second paid order, placed later, with delivery charged.
export const PAID_LATER = {
  ...PAID,
  id: '5a8d3b0f-4c2e-4f9b-8d7a-3e6c9f2b8d41',
  reference: 'H3TN8RW2QE',
  createdAt: '2026-11-09T07:44:51.120Z',
  holdExpiresAt: '2026-11-09T07:59:51.120Z',
  items: [LINE],
  itemsTotalRupees: 449,
  itemsGstRupees: 21,
  deliveryChargeRupees: 49,
  totalRupees: 498,
  delivery: {
    ...PAID.delivery,
    fullName: 'Rohan Mehta',
    phone: '9820098200',
    line1: 'Flat 4B, Sea View, Carter Road',
    line2: 'Bandra West',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400050',
  },
  payment: payment(498),
};

export const PACKED = {
  ...PAID,
  status: 'PACKED',
  packedAt: '2026-11-09T06:02:41.117Z',
};

export const SHIPPED = {
  ...PACKED,
  status: 'SHIPPED',
  shippedAt: '2026-11-09T09:30:05.902Z',
  courierName: 'Delhivery',
  trackingNumber: 'EE149081123456',
};

export const DELIVERED = {
  ...SHIPPED,
  status: 'DELIVERED',
  deliveredAt: '2026-11-11T12:15:00.000Z',
};

export const WAITING = {
  ...PAID,
  id: '6b9e4c1a-5d3f-4a0c-9e8b-4f7d0a3c9e52',
  reference: 'M2CX7V4PLD',
  status: 'PENDING_PAYMENT',
  createdAt: '2026-11-09T08:01:10.000Z',
  holdExpiresAt: '2026-11-09T08:16:10.000Z',
  payment: { ...payment(929), razorpayPaymentId: null, paidAt: null },
};

export const REFUND = {
  id: 'c3d2e1f0-9a8b-4c7d-8e6f-5a4b3c2d1e0f',
  razorpayPaymentId: 'pay_G3P9vcIhRs3NV4',
  razorpayRefundId: 'rfnd_RCe7Qm0LhZ2xYw' as string | null,
  amountRupees: 929,
  reason: 'CANCELLED_BY_STAFF',
  status: 'PENDING',
  createdAt: '2026-11-10T17:08:32.294Z',
  updatedAt: '2026-11-10T17:08:33.010Z',
};

export const CANCELLED = {
  ...PACKED,
  status: 'CANCELLED',
  payment: { ...payment(929), refunds: [REFUND] },
};

export const FAILED_REFUND = {
  ...REFUND,
  id: 'd4e3f2a1-0b9c-4d8e-9f7a-6b5c4d3e2f10',
  razorpayRefundId: null,
  reason: 'ALREADY_PAID',
  status: 'FAILED',
  amountRupees: 498,
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:05:00.000Z',
};

type Order = typeof PAID;

// The order as an Admin sees it: no payment at all.
export function forAdmin(order: Order) {
  const { payment: _payment, ...rest } = order;
  return rest;
}

export const summaryOf = (order: Order) => ({
  id: order.id,
  reference: order.reference,
  status: order.status,
  totalRupees: order.totalRupees,
  deliveryName: order.delivery.fullName,
  deliveryCity: order.delivery.city,
  deliveryState: order.delivery.state,
  createdAt: order.createdAt,
});

export const ORDERS = (query = '') => `GET /v1/staff/orders${query}`;
export const ORDER = (order: { id: string }) =>
  `GET /v1/staff/orders/${order.id}`;
export const STEP = (order: { id: string }, step: string) =>
  `POST /v1/staff/orders/${order.id}/${step}`;
// The menu's count of orders to pack.
export const TO_PACK = ORDERS('?status=PAID&limit=100');
export const REFUNDS = (query = '') => `GET /v1/staff/refunds${query}`;

export const ordersOf =
  (orders: Order[], nextAfter: string | null = null) =>
  () =>
    json(200, { orders: orders.map(summaryOf), nextAfter });
export const orderOf = (order: object) => () => json(200, order);
export const refundsOf =
  (
    refunds: (typeof REFUND & { orderId: string })[],
    nextAfter: string | null = null,
  ) =>
  () =>
    json(200, { refunds, nextAfter });
