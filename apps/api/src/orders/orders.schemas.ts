import { z } from 'zod';
import { RAZORPAY_PAYMENT_ID } from '../payments/razorpay.gateway';

// Placing an order: where it goes, and the total the customer saw. If the
// total has changed since, the order is refused, so nobody pays a price
// they did not see.
export const placeOrderSchema = z.object({
  addressId: z.uuid('Choose one of your delivery addresses'),
  totalRupees: z.number().int().min(1),
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

// The Idempotency-Key header: a new UUID for each order the customer
// means to place. Sending the same key again gives the same order.
export const idempotencyKeySchema = z.uuid(
  'Send an Idempotency-Key header: a new UUID for each order',
);

// A page of the customer's orders, newest first: a page size, and where to
// continue, by the ID of the last order shown.
export const orderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.uuid().optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

// Confirming a payment: what Razorpay's payment page gave the app when the
// customer paid, as razorpay_payment_id and razorpay_signature. The
// Razorpay order is never taken from the app: the server knows it.
export const confirmPaymentSchema = z.object({
  razorpayPaymentId: z
    .string()
    .regex(
      RAZORPAY_PAYMENT_ID,
      "Send the razorpay_payment_id from Razorpay's payment page",
    ),
  razorpaySignature: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "Send the razorpay_signature from Razorpay's payment page",
    ),
});
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;
