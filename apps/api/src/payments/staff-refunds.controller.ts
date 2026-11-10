import { Controller, Get, Query } from '@nestjs/common';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { refundListQuerySchema } from './payments.schemas';
import type { RefundListQuery } from './payments.schemas';
import { PaymentsService } from './payments.service';

// Refunds for Super Users only (ADR 0028): Admins never handle money. The
// FAILED ones are those Razorpay refused, for staff to give back by hand.
// A Super User route takes staff tokens only. Reading is not audited.
@SuperUserOnly()
@Controller('staff/refunds')
export class StaffRefundsController {
  constructor(private readonly payments: PaymentsService) {}

  // The newest first, one page at a time: the nextAfter of one page is the
  // ?after= of the next.
  @Get()
  list(
    @Query(new ZodValidationPipe(refundListQuerySchema)) query: RefundListQuery,
  ) {
    return this.payments.listRefunds(query);
  }
}
