import { z } from 'zod';
import { PackUnit } from '../generated/prisma/enums';
import type { ProductIssue } from './product-rules';

export const PRICE_ABOVE_MRP = 'The price may not be more than the MRP';

// Staff's own code for a pack, in capitals: " ash-cap-60 " is stored as
// "ASH-CAP-60".
const sku = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, 'An SKU has at least 3 characters')
  .max(40)
  .regex(
    /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
    'An SKU has letters, digits and single hyphens, like "ASH-CAP-60"',
  );
// The net quantity on the label, as a whole number in its unit.
const quantity = z.number().int().min(1).max(1_000_000);
const unit = z.enum(
  PackUnit,
  'Choose G, KG, ML, L, CAPSULES, TABLETS or PIECES',
);
// Whole paise: 45000 is Rs 450.00. At most Rs 10,00,000.
const paise = z.number().int().min(1).max(100_000_000);
// The order on the product's page.
const position = z.number().int().min(0).max(9999);

// What stops a pack size from being saved with these prices: the law
// forbids charging more than the MRP printed on the pack (ADR 0022).
export function priceIssues(variant: {
  mrpPaise: number;
  pricePaise: number;
}): ProductIssue[] {
  return variant.pricePaise > variant.mrpPaise
    ? [{ field: 'pricePaise', message: PRICE_ABOVE_MRP }]
    : [];
}

// A new pack size of a product. It is on sale unless isActive is false.
export const variantSchema = z
  .object({
    sku,
    quantity,
    unit,
    mrpPaise: paise,
    pricePaise: paise,
    isActive: z.boolean().optional(),
    position: position.optional(),
  })
  .refine((input) => priceIssues(input).length === 0, {
    message: PRICE_ABOVE_MRP,
    path: ['pricePaise'],
    // Only when everything else is valid, so a wrong MRP gets one error,
    // not a second one about the price.
    when: (payload) => payload.issues.length === 0,
  });
export type VariantInput = z.infer<typeof variantSchema>;

// A change to a pack size: only the fields that change. Whether the price
// stays within the MRP is checked against the pack as it will be, when it
// is saved: a lower MRP alone may fall below the stored price.
export const variantUpdateSchema = z
  .object({
    sku: sku.optional(),
    quantity: quantity.optional(),
    unit: unit.optional(),
    mrpPaise: paise.optional(),
    pricePaise: paise.optional(),
    isActive: z.boolean().optional(),
    position: position.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Nothing to change',
  );
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>;
