import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RazorpayGateway } from './razorpay.gateway';
import { StaffRefundsController } from './staff-refunds.controller';

// Online payments (ADR 0027). Razorpay is reached only through
// RazorpayGateway, and the other modules ask PaymentsService. Super Users
// list refunds (ADR 0028).
@Module({
  controllers: [StaffRefundsController],
  providers: [PaymentsService, RazorpayGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
