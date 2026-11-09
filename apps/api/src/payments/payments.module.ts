import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RazorpayGateway } from './razorpay.gateway';

// Online payments (ADR 0027). Razorpay is reached only through
// RazorpayGateway, and the other modules ask PaymentsService.
@Module({
  providers: [PaymentsService, RazorpayGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
