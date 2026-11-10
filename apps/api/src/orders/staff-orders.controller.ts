import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffOnly } from '../auth/staff-only.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  shipmentCorrectionSchema,
  shipmentSchema,
  staffOrderListQuerySchema,
} from './orders.schemas';
import type {
  ShipmentCorrection,
  ShipmentInput,
  StaffOrderListQuery,
} from './orders.schemas';
import { StaffOrdersService, type StaffViewer } from './staff-orders.service';

// Orders for staff (ADR 0028). Admins and Super Users see every order, and
// mark it packed, shipped and delivered; every step is written to the audit
// log. Only Super Users see an order's payment and refunds, with Razorpay's
// IDs, and cancel an order: Admins never handle money. Reading is not
// audited.
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
    return this.orders.view(id, viewerOf(user));
  }

  // Marks a paid order packed. Each step answers the order as it is now.
  @Post(':id/packed')
  @HttpCode(HttpStatus.OK)
  markPacked(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.orders.markPacked(id, context, viewerOf(user));
  }

  // Marks a packed order shipped, with the courier and its tracking number.
  @Post(':id/shipped')
  @HttpCode(HttpStatus.OK)
  markShipped(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(shipmentSchema)) body: ShipmentInput,
    @CurrentUser() user: AuthUser,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.orders.markShipped(id, body, context, viewerOf(user));
  }

  // Corrects the courier or tracking number while the order is on its way.
  @Patch(':id/shipment')
  correctShipment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(shipmentCorrectionSchema))
    body: ShipmentCorrection,
    @CurrentUser() user: AuthUser,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.orders.correctShipment(id, body, context, viewerOf(user));
  }

  // Marks a shipped order delivered.
  @Post(':id/delivered')
  @HttpCode(HttpStatus.OK)
  markDelivered(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.orders.markDelivered(id, context, viewerOf(user));
  }

  // Cancels an order that hasn't shipped. A paid order's money goes back
  // in full, so only a Super User may: Admins get 403.
  @SuperUserOnly()
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.orders.cancel(id, context, viewerOf(user));
  }
}

// Only a Super User sees an order's payment.
function viewerOf(user: AuthUser): StaffViewer {
  return { withPayment: user.role === 'SUPER_USER' };
}
