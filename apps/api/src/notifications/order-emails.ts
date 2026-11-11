import type { PackUnit, RefundReason } from '../generated/prisma/enums';
import { escapeHtml } from '../mail/mail.service';
import type { MailMessage } from '../mail/mail.types';

// The words of the order emails (ADR 0029). Each email is a few
// paragraphs, written once: the text as it is, the HTML escaped. No links,
// so no email teaches anyone to click one: the customer opens the app or
// the website themselves. Money is in whole rupees, as everywhere.

// An email without its address: the sender adds who it goes to.
export type EmailContent = Omit<MailMessage, 'to'>;

// One line of an order, as the email shows it.
export interface OrderEmailLine {
  productName: string;
  quantity: number;
  unit: PackUnit;
  packs: number;
  lineTotalRupees: number;
}

// What the paid email shows of an order.
export interface PaidOrder {
  reference: string;
  items: OrderEmailLine[];
  itemsTotalRupees: number;
  itemsGstRupees: number;
  deliveryChargeRupees: number;
  totalRupees: number;
  deliveryName: string;
  deliveryLine1: string;
  deliveryLine2: string | null;
  deliveryCity: string;
  deliveryState: string;
  deliveryPincode: string;
}

// An order on its way, with its courier and tracking number.
export interface Shipment {
  reference: string;
  courierName: string;
  trackingNumber: string;
}

const INDIAN = new Intl.NumberFormat('en-IN');

// "Rs 1,29,999": rupees, grouped the Indian way.
export function rupees(amount: number): string {
  return `Rs ${INDIAN.format(amount)}`;
}

const UNIT_WORDS = {
  G: ['g', 'g'],
  KG: ['kg', 'kg'],
  ML: ['ml', 'ml'],
  L: ['L', 'L'],
  CAPSULES: ['capsule', 'capsules'],
  TABLETS: ['tablet', 'tablets'],
  PIECES: ['piece', 'pieces'],
} as const satisfies Record<PackUnit, readonly [string, string]>;

// "60 capsules", "1 piece", "100 g".
function packSize(quantity: number, unit: PackUnit): string {
  const [one, many] = UNIT_WORDS[unit];
  return `${quantity} ${quantity === 1 ? one : many}`;
}

// Why money went back, in the customer's words.
const REFUND_REASONS = {
  ORDER_EXPIRED:
    'The payment came after the order had expired, and its items were no longer in stock.',
  ORDER_CANCELLED: 'The payment came for an order that had been cancelled.',
  ALREADY_PAID: 'It was a second payment for an order that was already paid.',
  CANCELLED_BY_CUSTOMER: 'The order was cancelled before it shipped.',
  CANCELLED_BY_STAFF: 'The order was cancelled before it shipped.',
} as const satisfies Record<RefundReason, string>;

// The text is the paragraphs, one empty line apart. In the HTML, each is a
// paragraph, escaped, its line breaks kept.
function email(subject: string, paragraphs: string[]): EmailContent {
  return {
    subject,
    text: paragraphs.join('\n\n'),
    html: paragraphs
      .map(
        (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`,
      )
      .join(''),
  };
}

const hello = (fullName: string) => `Hello ${fullName},`;

// To the customer, once the order is paid: everything in it, as a record
// to keep.
export function orderPaid(fullName: string, order: PaidOrder): EmailContent {
  const lines = order.items.map(
    (line) =>
      `${line.productName}: ${line.packs} ${line.packs === 1 ? 'pack' : 'packs'} of ${packSize(line.quantity, line.unit)}, ${rupees(line.lineTotalRupees)}`,
  );
  const address = [
    order.deliveryName,
    order.deliveryLine1,
    ...(order.deliveryLine2 ? [order.deliveryLine2] : []),
    `${order.deliveryCity}, ${order.deliveryState} ${order.deliveryPincode}`,
  ];
  return email(`Your order ${order.reference} is confirmed`, [
    hello(fullName),
    `Thank you for your order. We have received your payment for order ${order.reference}.`,
    lines.join('\n'),
    [
      `Items: ${rupees(order.itemsTotalRupees)} (GST included: ${rupees(order.itemsGstRupees)})`,
      `Delivery: ${order.deliveryChargeRupees === 0 ? 'free' : rupees(order.deliveryChargeRupees)}`,
      `Total paid: ${rupees(order.totalRupees)}`,
    ].join('\n'),
    `Delivering to:\n${address.join('\n')}`,
    'We will email you again when your order is packed, and when it ships with its tracking number.',
  ]);
}

export function orderPacked(fullName: string, reference: string): EmailContent {
  return email(`Your order ${reference} is packed`, [
    hello(fullName),
    `Your order ${reference} is packed, and will be handed to the courier soon.`,
    'We will email you its tracking number when it ships.',
  ]);
}

// When staff correct the courier or the tracking number, the customer gets
// the new ones, and is told to use them instead.
export function orderShipped(
  fullName: string,
  shipment: Shipment,
  corrected: boolean,
): EmailContent {
  const details = `Courier: ${shipment.courierName}\nTracking number: ${shipment.trackingNumber}`;
  return corrected
    ? email(`New tracking details for your order ${shipment.reference}`, [
        hello(fullName),
        `We have corrected the shipping details of your order ${shipment.reference}. Please use these instead of the ones we sent before.`,
        details,
      ])
    : email(`Your order ${shipment.reference} is on its way`, [
        hello(fullName),
        `Your order ${shipment.reference} has been handed to the courier.`,
        details,
        "You can follow it on the courier's own website or app, with this tracking number.",
      ]);
}

export function orderDelivered(
  fullName: string,
  reference: string,
): EmailContent {
  return email(`Your order ${reference} is delivered`, [
    hello(fullName),
    `Your order ${reference} has been marked delivered.`,
    'Thank you for shopping with us.',
  ]);
}

// A paid order's payment goes back in full; the customer is told when it
// is back.
export function orderCancelled(
  fullName: string,
  reference: string,
  refundRupees: number | null,
): EmailContent {
  return email(`Your order ${reference} is cancelled`, [
    hello(fullName),
    `Your order ${reference} has been cancelled.`,
    ...(refundRupees === null
      ? []
      : [
          `Your payment of ${rupees(refundRupees)} is going back to you in full, to the account or card you paid with. We will email you again when it is back.`,
        ]),
  ]);
}

export function refundProcessed(
  fullName: string,
  reference: string,
  amountRupees: number,
  reason: RefundReason,
): EmailContent {
  return email(`Your refund for order ${reference} is complete`, [
    hello(fullName),
    `We have sent ${rupees(amountRupees)} for order ${reference} back to the account or card you paid with. Your bank may take a few working days to show it.`,
    REFUND_REASONS[reason],
  ]);
}

// To the Super Users: Razorpay could not give the money back, so a person
// must. No customer details: they are in the staff routes.
export function refundFailed(
  reference: string,
  refundId: string,
  amountRupees: number,
  reason: RefundReason,
): EmailContent {
  return email(`Action needed: a refund for order ${reference} failed`, [
    `Razorpay could not give back ${rupees(amountRupees)} for order ${reference}. The customer does not have this money back.`,
    `Refund: ${refundId}\nReason: ${reason}. ${REFUND_REASONS[reason]}`,
    'Please give the money back by hand. The failed refunds are listed at GET /v1/staff/refunds?status=FAILED, for Super Users.',
  ]);
}
