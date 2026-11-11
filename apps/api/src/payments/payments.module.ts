import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsService } from './payments.service';
import { RazorpayGateway } from './razorpay.gateway';
import { StaffRefundsController } from './staff-refunds.controller';

// Online payments (ADR 0027). Razorpay is reached only through
// RazorpayGateway, and the other modules ask PaymentsService. Super Users
// list refunds (ADR 0028). A refund given back, or failed, saves the email
// that tells of it (ADR 0029).
@Module({
  imports: [NotificationsModule],
  controllers: [StaffRefundsController],
  providers: [PaymentsService, RazorpayGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
