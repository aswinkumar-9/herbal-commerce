import { z } from 'zod';
import { MAX_PACKS_PER_PRODUCT } from './cart-rules';

// How many packs of one pack size the cart should hold: 1 to 4. Taking a
// pack size out of the cart is a delete, not 0.
export const cartItemSchema = z.object({
  packs: z
    .number()
    .int()
    .min(1, 'At least 1 pack. To take it out of the cart, delete it.')
    .max(
      MAX_PACKS_PER_PRODUCT,
      `At most ${MAX_PACKS_PER_PRODUCT} packs of one product`,
    ),
});
export type CartItemInput = z.infer<typeof cartItemSchema>;
