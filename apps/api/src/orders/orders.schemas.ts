import { z } from 'zod';

// Placing an order: where it goes, and the total the customer saw. If the
// total has changed since, the order is refused, so nobody pays a price
// they did not see.
export const placeOrderSchema = z.object({
  addressId: z.uuid('Choose one of your delivery addresses'),
  totalPaise: z.number().int().min(1),
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
