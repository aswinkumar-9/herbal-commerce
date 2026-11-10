import { z } from 'zod';
import { RefundStatus } from '../generated/prisma/enums';

// A page of refunds, for Super Users (ADR 0028): the newest first, those in
// one status if asked, such as the FAILED ones that staff must give back by
// hand. Pages continue after the ID of the last refund shown.
export const refundListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.uuid().optional(),
  status: z
    .enum(RefundStatus, 'Use REQUESTED, PENDING, PROCESSED or FAILED')
    .optional(),
});
export type RefundListQuery = z.infer<typeof refundListQuerySchema>;
