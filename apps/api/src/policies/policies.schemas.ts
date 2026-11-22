import { z } from 'zod';

// The longest text a policy page may hold (ADR 0040). Even at three bytes a
// character, as in Hindi, it fits in the API's 100 kB limit for a request.
export const POLICY_MAX_LENGTH = 30_000;

// Control characters other than tab and line end. Pasted from a document,
// they hide in the text, and show as nothing or as boxes.
// oxlint-disable-next-line no-control-regex -- finding them is the point
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

// Every save moves a page's revision on by one; a Postgres integer.
const revision = z.number().int().min(0).max(2_147_483_647);

// The text as the Super User wrote it, cleaned the way the database expects
// it: Unix line ends, and no spaces, tabs or blank lines at its ends.
const body = z
  .string()
  .transform((text) =>
    text.replace(/\r\n?/g, '\n').replace(/^[ \t\n]+|[ \t\n]+$/g, ''),
  )
  .pipe(
    z
      .string()
      .min(1, 'Write the page first')
      .max(
        POLICY_MAX_LENGTH,
        `A page holds at most ${POLICY_MAX_LENGTH.toLocaleString('en-IN')} characters`,
      )
      .refine(
        (text) => !HIDDEN.test(text),
        'The text has hidden control characters: paste it as plain text',
      ),
  );

// Saving a draft names the revision it was written on, so a change saved
// meanwhile by someone else is never overwritten unseen.
export const saveDraftSchema = z.object({ body, revision });
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

// Publishing names the revision previewed, so exactly that text goes live.
export const publishSchema = z.object({ revision });
export type PublishInput = z.infer<typeof publishSchema>;

// Discarding a draft names its revision in the address: ?revision=3.
export const discardQuerySchema = z.object({
  revision: z
    .string()
    .regex(/^\d{1,10}$/, 'Give the revision as a whole number')
    .transform(Number)
    .pipe(revision),
});
export type DiscardQuery = z.infer<typeof discardQuerySchema>;

// A page of a policy page's versions (part 14B): the newest first, the
// older ones on asking, as every list staff page through. Query values
// arrive as text, so the numbers are converted. Unknown parameters are
// dropped.
export const versionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // The last version shown: the page goes on with the ones below it.
  before: z.coerce.number().int().min(1).max(999_999_999).optional(),
});
export type VersionsQuery = z.infer<typeof versionsQuerySchema>;

// A version's number in an address: 1, 2, 3 …
export const versionParamSchema = z
  .string()
  .regex(/^[1-9]\d{0,8}$/, 'Give the version as a whole number from 1')
  .transform(Number);
