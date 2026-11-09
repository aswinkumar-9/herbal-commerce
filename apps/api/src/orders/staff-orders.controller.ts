import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffOnly } from '../auth/staff-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { staffOrderListQuerySchema } from './orders.schemas';
import type { StaffOrderListQuery } from './orders.schemas';
import { StaffOrdersService } from './staff-orders.service';

// Orders for staff (ADR 0028). Admins and Super Users see every order, to
// pack and ship it. Only Super Users see an order's payment and refunds,
// with Razorpay's IDs: Admins never handle money. Reading is not audited.
@StaffOnly()
@Controller('staff/orders')
export class StaffOrdersController {
  constructor(private readonly orders: StaffOrdersService) {}

  // Every order, one page at a time: the nextAfter of one page is the
  // ?after= of the next. ?status=PAID&sort=oldest is the work to pack.
  @Get()
  list(
    @Query(new ZodValidationPipe(staffOrderListQuerySchema))
    query: StaffOrderListQuery,
  ) {
    return this.orders.list(query);
  }

  // One order, with its payment for a Super User.
  @Get(':id')
  view(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orders.view(id, { withPayment: user.role === 'SUPER_USER' });
  }
}
