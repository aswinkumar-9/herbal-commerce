import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { RazorpayWebhooksService } from './razorpay-webhooks.service';

// Razorpay's webhooks (ADR 0027). Public: Razorpay has no token. Its
// signature over the body, with our webhook secret, proves the webhook is
// Razorpay's, so the body is kept exactly as it arrived (rawBody, main.ts).
@Controller('payments/razorpay')
export class RazorpayWebhooksController {
  constructor(private readonly webhooks: RazorpayWebhooksService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ): Promise<void> {
    await this.webhooks.receive(request.rawBody, signature);
  }
}
