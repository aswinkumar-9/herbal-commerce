import { z } from 'zod';
import { RefundStatus } from '../generated/prisma/enums';

// A page of refunds, for Super Users (ADR 0028): the newest first, those in
// one status if asked, such as the FAILED ones that staff must give back by
// hand. With givenBack=false, only those not given back by hand yet; with
// givenBack=true, only those that were (ADR 0038). Pages continue after the
// ID of the last refund shown.
export const refundListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.uuid().optional(),
  status: z
    .enum(RefundStatus, 'Use REQUESTED, PENDING, PROCESSED or FAILED')
    .optional(),
  givenBack: z
    .enum(['true', 'false'], 'Use true or false')
    .transform((value) => value === 'true')
    .optional(),
});
export type RefundListQuery = z.infer<typeof refundListQuerySchema>;

// How a Super User gave back the money Razorpay could not (ADR 0038), such
// as "Bank transfer, UTR 412345678901". Spaces and line breaks at the ends
// are dropped, and Windows line breaks made plain ones.
export const givenBackSchema = z.object({
  note: z
    .string('Say how the money was given back')
    .trim()
    .transform((value) => value.replace(/\r\n?/g, '\n'))
    .pipe(
      z
        .string()
        .min(3, 'Say how the money was given back, in 3 to 500 characters')
        .max(500, 'Say how the money was given back, in 3 to 500 characters'),
    ),
});
export type GivenBackInput = z.infer<typeof givenBackSchema>;
