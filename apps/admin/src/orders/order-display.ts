import type {
  OrderQuery,
  OrderStatus,
  RefundReason,
  RefundStatus,
} from './orders-api';

// How orders read on screen (ADR 0037).

export const STATUS_NAMES: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Waiting for payment',
  PAID: 'To pack',
  PACKED: 'Packed',
  SHIPPED: 'On its way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

// Each status in its colour; the word says it too.
export const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'bg-surface-muted text-ink-muted',
  PAID: 'bg-warning-soft text-warning',
  PACKED: 'bg-primary-soft text-primary-strong',
  SHIPPED: 'bg-primary-soft text-primary-strong',
  DELIVERED: 'bg-primary-soft text-primary-strong',
  CANCELLED: 'bg-danger-soft text-danger',
  EXPIRED: 'bg-surface-muted text-ink-muted',
};

export type OrderFilterName =
  | 'to-pack'
  | 'packed'
  | 'on-its-way'
  | 'delivered'
  | 'cancelled'
  | 'waiting'
  | 'expired'
  | 'all';

export interface OrderFilter {
  // In the address as ?show=…; the first is the default, with none.
  name: OrderFilterName;
  label: string;
  query: Omit<OrderQuery, 'after' | 'reference'>;
  // What the list holds, under the chips.
  summary: string;
  // When it holds nothing.
  empty: { title: string; text: string };
}

// What there is to pack: the list staff see first.
const TO_PACK: OrderFilter = {
  name: 'to-pack',
  label: 'To pack',
  query: { status: 'PAID', sort: 'oldest' },
  summary: 'Paid orders waiting to be packed, the oldest first.',
  empty: {
    title: 'Nothing to pack',
    text: 'Every paid order is packed. New ones appear here by themselves.',
  },
};

// The work comes first, the oldest first, as it should be done in turn.
// What is done or never happened is newest first.
export const ORDER_FILTERS: readonly OrderFilter[] = [
  TO_PACK,
  {
    name: 'packed',
    label: 'Packed',
    query: { status: 'PACKED', sort: 'oldest' },
    summary: 'Packed orders waiting for the courier, the oldest first.',
    empty: {
      title: 'Nothing waits for the courier',
      text: 'Every packed order has been handed to a courier.',
    },
  },
  {
    name: 'on-its-way',
    label: 'On its way',
    query: { status: 'SHIPPED', sort: 'oldest' },
    summary: 'Orders with the courier, the oldest first.',
    empty: {
      title: 'Nothing is on its way',
      text: 'No order is with a courier now.',
    },
  },
  {
    name: 'delivered',
    label: 'Delivered',
    query: { status: 'DELIVERED' },
    summary: 'Delivered orders, the newest first.',
    empty: {
      title: 'No order delivered yet',
      text: 'Orders show here once they are marked delivered.',
    },
  },
  {
    name: 'cancelled',
    label: 'Cancelled',
    query: { status: 'CANCELLED' },
    summary:
      'Orders cancelled before they shipped, the newest first. A paid one’s payment went back in full.',
    empty: {
      title: 'No order cancelled',
      text: 'Orders cancelled by a customer or a Super User show here.',
    },
  },
  {
    name: 'waiting',
    label: 'Waiting for payment',
    query: { status: 'PENDING_PAYMENT' },
    summary:
      'Orders placed but not paid yet, the newest first. Each holds its stock for 15 minutes.',
    empty: {
      title: 'No order waits for payment',
      text: 'Orders show here while customers pay.',
    },
  },
  {
    name: 'expired',
    label: 'Expired',
    query: { status: 'EXPIRED' },
    summary:
      'Orders not paid in time, the newest first. Their stock went back.',
    empty: {
      title: 'No order expired',
      text: 'Orders not paid within 15 minutes show here.',
    },
  },
  {
    name: 'all',
    label: 'All',
    query: {},
    summary: 'Every order, the newest first.',
    empty: {
      title: 'No orders yet',
      text: 'Orders show here as customers place them.',
    },
  },
];

// The filter in the address, or what there is to pack.
export function orderFilter(name: string | null): OrderFilter {
  return ORDER_FILTERS.find((filter) => filter.name === name) ?? TO_PACK;
}

// The menu's count: up to 99, then "99+".
export function countName({
  count,
  more,
}: {
  count: number;
  more: boolean;
}): string {
  return more || count > 99 ? '99+' : String(count);
}

// Where an order goes: "Bengaluru, Karnataka".
export function placeName(order: {
  deliveryCity: string;
  deliveryState: string;
}): string {
  return `${order.deliveryCity}, ${order.deliveryState}`;
}

// Why money went back, as staff read it.
export const REFUND_REASON_NAMES: Record<RefundReason, string> = {
  ORDER_EXPIRED: 'Paid after the order expired, with its stock gone',
  ORDER_CANCELLED: 'Paid for an order already cancelled',
  ALREADY_PAID: 'A second payment for an order already paid',
  CANCELLED_BY_CUSTOMER: 'The customer cancelled the order',
  CANCELLED_BY_STAFF: 'A Super User cancelled the order',
};

// How a refund shows: as its status, or, once a Super User gave a failed
// one back by hand (ADR 0038), as given back.
export type RefundShown = RefundStatus | 'GIVEN_BACK';

export function refundShown(refund: {
  status: RefundStatus;
  givenBackAt: string | null;
}): RefundShown {
  return refund.status === 'FAILED' && refund.givenBackAt
    ? 'GIVEN_BACK'
    : refund.status;
}

export const REFUND_STATUS_NAMES: Record<RefundShown, string> = {
  REQUESTED: 'Being sent to Razorpay',
  PENDING: 'On its way back',
  PROCESSED: 'Back with the customer',
  FAILED: 'Failed: give it back by hand',
  GIVEN_BACK: 'Given back by hand',
};

export const REFUND_STATUS_STYLES: Record<RefundShown, string> = {
  REQUESTED: 'bg-surface-muted text-ink-muted',
  PENDING: 'bg-warning-soft text-warning',
  PROCESSED: 'bg-primary-soft text-primary-strong',
  FAILED: 'bg-danger-soft text-danger',
  GIVEN_BACK: 'bg-primary-soft text-primary-strong',
};

// What a failed refund asks of a Super User.
export const FAILED_REFUND_HELP =
  'Razorpay could not give this money back. Give it back by hand in the Razorpay dashboard, from the payment named here, then mark it as given back.';

// How a Super User gave a failed refund back (ADR 0038), as the API takes
// it: 3 to 500 characters, without spaces at the ends.
export const GIVEN_BACK_NOTE_MAX = 500;
export const GIVEN_BACK_NOTE_PROBLEM =
  'Say how the money was given back, in 3 to 500 characters';

// The note as it will be sent, or undefined if the API would refuse it.
export function givenBackNote(typed: string): string | undefined {
  const note = typed.trim().replace(/\r\n?/g, '\n');
  return note.length >= 3 && note.length <= GIVEN_BACK_NOTE_MAX
    ? note
    : undefined;
}
