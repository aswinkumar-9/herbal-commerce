import { z } from 'zod';
import { daysIn, MAX_PERIOD_DAYS } from './sales-periods';

// A day in India, such as 2026-11-25.
const day = z.iso.date('Use a date such as 2026-11-25');

// Checked only once both days are real dates.
const bothDays = (payload: { issues: readonly unknown[] }) =>
  payload.issues.length === 0;

// What the report may be narrowed to, by ID: in small letters, as the
// database keeps them.
const filterId = (what: string) =>
  z
    .uuid(`Choose ${what} by its ID`)
    .transform((id) => id.toLowerCase())
    .optional();

// The period of the sales report (ADR 0047): from one day to another, both
// included, at most MAX_PERIOD_DAYS long. A day still to come simply has no
// sales yet. It may be narrowed to the sales of a product, of a category
// (a top one with its subcategories, or a subcategory) or of a brand, or of
// those together.
export const salesReportQuerySchema = z
  .object({
    from: day,
    to: day,
    productId: filterId('a product'),
    categoryId: filterId('a category'),
    brandId: filterId('a brand'),
  })
  .refine((query) => query.from <= query.to, {
    message: 'The period starts after it ends',
    path: ['to'],
    when: bothDays,
  })
  .refine((query) => daysIn(query.from, query.to) <= MAX_PERIOD_DAYS, {
    message: `Choose at most ${MAX_PERIOD_DAYS} days`,
    path: ['to'],
    when: bothDays,
  });
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
