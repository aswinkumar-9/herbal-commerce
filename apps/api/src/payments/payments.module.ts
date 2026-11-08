import { Module } from '@nestjs/common';
import { RazorpayGateway } from './razorpay.gateway';

// Online payments (ADR 0027). Razorpay is reached only through
// RazorpayGateway.
@Module({
  providers: [RazorpayGateway],
  exports: [RazorpayGateway],
})
export class PaymentsModule {}
