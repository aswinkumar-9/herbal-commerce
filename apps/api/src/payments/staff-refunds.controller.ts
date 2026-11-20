import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { givenBackSchema, refundListQuerySchema } from './payments.schemas';
import type { GivenBackInput, RefundListQuery } from './payments.schemas';
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

  // A failed refund the Super User gave back another way, and how
  // (ADR 0038). Answers the refund as it is now.
  @Post(':id/given-back')
  @HttpCode(HttpStatus.OK)
  givenBack(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(givenBackSchema)) body: GivenBackInput,
    @CurrentUser() user: AuthUser,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.payments.giveBackByHand(id, body, user.id, context);
  }
}
