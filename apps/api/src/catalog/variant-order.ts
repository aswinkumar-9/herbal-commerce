import type { Prisma } from '../generated/prisma/client';

// The order of a product's pack sizes, for staff and in the shop alike: by
// position, then the smallest pack (ADR 0022).
export const VARIANT_ORDER = [
  { position: 'asc' },
  { quantity: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductVariantOrderByWithRelationInput[];
