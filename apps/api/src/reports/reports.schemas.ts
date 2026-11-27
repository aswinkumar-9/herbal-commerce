import { z } from 'zod';
import { INDIAN_STATES } from '../addresses/addresses.schemas';
import { PaymentMethod } from '../generated/prisma/enums';
import {
  barsOf,
  daysIn,
  MAX_BARS,
  MAX_PERIOD_DAYS,
  SERIES_UNITS,
} from './sales-periods';

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

// The payments made before part 15C, which keep no method (ADR 0046).
export const NOT_RECORDED = 'NOT_RECORDED';

// The period of the sales report (ADR 0047): from one day to another, both
// included, at most MAX_PERIOD_DAYS long. A day still to come simply has no
// sales yet. It may be narrowed to the sales of a product, of a category
// (a top one with its subcategories, or a subcategory) or of a brand, of
// the orders sent to a state, or of those paid one way (part 15E), or of
// those together. Its chart's bars are chosen for its length, unless asked
// for: at most MAX_BARS of them.
export const salesReportQuerySchema = z
  .object({
    from: day,
    to: day,
    productId: filterId('a product'),
    categoryId: filterId('a category'),
    brandId: filterId('a brand'),
    state: z
      .enum(INDIAN_STATES, 'Choose a state or union territory from the list')
      .optional(),
    method: z
      .enum(
        [...Object.values(PaymentMethod), NOT_RECORDED],
        'Choose a payment method from the list',
      )
      .optional(),
    unit: z
      .enum(SERIES_UNITS, 'Choose days, weeks, months, quarters or years')
      .optional(),
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
  })
  .refine(
    (query) =>
      !query.unit ||
      barsOf(query.from, query.to, query.unit).length <= MAX_BARS,
    {
      message: `Choose bigger bars: a chart has at most ${MAX_BARS}`,
      path: ['unit'],
      when: bothDays,
    },
  );
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
