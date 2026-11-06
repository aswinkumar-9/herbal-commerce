import { z } from 'zod';
import { StockReason } from '../generated/prisma/enums';

// As printed on the pack, with spaces dropped and letters made capitals:
// " ab 2611 " is stored as "AB2611".
const batchNumber = z
  .string()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .min(1, 'Enter the batch number')
      .max(40)
      // Empty is left to the rule above, for one clear message.
      .regex(
        /^([A-Z0-9][A-Z0-9/.-]*)?$/,
        'A batch number has letters, digits, "/", "." and "-"',
      ),
  );
// A date as on the label, such as 2026-10-31. It is stored as that day.
const labelDate = z
  .iso.date('Use a date like 2026-10-31')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));
// How many packs: a whole number from 1 to 1,000,000.
const quantity = z.number().int().min(1).max(1_000_000);
// Optional, up to 200 characters. Empty, or null, means none.
const note = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .transform((value) => value || null);

// Only when everything else is valid, so a wrong field gets one error.
const onceValid = (payload: { issues: unknown[] }) =>
  payload.issues.length === 0;

// A new batch, as it arrives: its label's details and how many packs came.
// Whether its dates make sense today is checked when it is saved.
export const batchSchema = z.object({
  batchNumber,
  manufacturedOn: labelDate,
  expiresOn: labelDate,
  quantity,
  note: note.optional(),
});
export type BatchInput = z.infer<typeof batchSchema>;

// A correction to a batch's label details. Its stock changes only through
// movements, never here.
export const batchUpdateSchema = z
  .object({
    batchNumber: batchNumber.optional(),
    manufacturedOn: labelDate.optional(),
    expiresOn: labelDate.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Nothing to change',
  );
export type BatchUpdateInput = z.infer<typeof batchUpdateSchema>;

// A change to a batch's stock. A delivery adds, a write-off removes, and a
// correction may go either way but must say why. The database holds the
// same rules about the sign.
export const movementSchema = z
  .object({
    change: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((value) => value !== 0, 'A change of 0 changes nothing'),
    reason: z.enum(
      StockReason,
      'Choose RECEIVED, DAMAGED, EXPIRED or CORRECTION',
    ),
    note: note.optional(),
  })
  .refine((input) => input.reason !== 'RECEIVED' || input.change > 0, {
    path: ['change'],
    message: 'A delivery adds stock: use a positive number',
    when: onceValid,
  })
  .refine(
    (input) =>
      (input.reason !== 'DAMAGED' && input.reason !== 'EXPIRED') ||
      input.change < 0,
    {
      path: ['change'],
      message: 'A write-off removes stock: use a negative number',
      when: onceValid,
    },
  )
  .refine(
    (input) => input.reason !== 'CORRECTION' || Boolean(input.note),
    {
      path: ['note'],
      message: 'Say why the count differs',
      when: onceValid,
    },
  );
export type MovementInput = z.infer<typeof movementSchema>;

// What staff may ask of a batch's movements: a page size, and where to
// continue, by the ID of the last movement shown. Newest first.
export const movementListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.uuid().optional(),
});
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;
