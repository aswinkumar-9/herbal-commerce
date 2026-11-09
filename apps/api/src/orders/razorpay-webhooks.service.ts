import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { RetryLaterException } from '../common/retry-later.exception';
import { PaymentsService } from '../payments/payments.service';
import {
  RAZORPAY_PAYMENT_ID,
  RAZORPAY_REFUND_ID,
  RazorpayError,
} from '../payments/razorpay.gateway';
import { OrderPaymentsService } from './order-payments.service';
import { PAYMENTS_UNAVAILABLE } from './order-rules';

export const WEBHOOK_NOT_VERIFIED = 'The webhook could not be verified.';

// How long Razorpay is asked to wait before sending the webhook again.
const RETRY_WEBHOOK_SECONDS = 30;

// The parts of a Razorpay webhook that are read (ADR 0027). A payment is
// only named: whether it was captured, and for which order, is asked of
// Razorpay again.
const webhookEvent = z.object({
  event: z.string(),
  payload: z.object({
    payment: z
      .object({
        entity: z.object({ id: z.string().regex(RAZORPAY_PAYMENT_ID) }),
      })
      .optional(),
    refund: z
      .object({
        entity: z.object({
          id: z.string().regex(RAZORPAY_REFUND_ID),
          receipt: z.string().nullish(),
          status: z.enum(['pending', 'processed', 'failed']),
        }),
      })
      .optional(),
  }),
});

const PAYMENT_EVENTS = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'order.paid',
]);
const REFUND_EVENTS = new Set([
  'refund.created',
  'refund.processed',
  'refund.failed',
]);

// Razorpay's webhooks (ADR 0027): Razorpay tells us that a payment or a
// refund changed, even when the customer closed the app before confirming.
@Injectable()
export class RazorpayWebhooksService {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orderPayments: OrderPaymentsService,
    @InjectPinoLogger(RazorpayWebhooksService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Handles one webhook. It must be signed by Razorpay, over the body exactly
  // as it arrived. A payment is settled by the same rules as a confirmation,
  // on Razorpay's own word; a refund moves forward. Razorpay sends a webhook
  // again until it gets a 2xx answer, so an answer of 5xx means "try again
  // later", and the same webhook twice changes nothing.
  async receive(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    if (
      !rawBody ||
      !this.payments.isWebhookSignatureValid(rawBody, signature)
    ) {
      this.logger.warn('A Razorpay webhook came with a wrong signature');
      throw new BadRequestException(WEBHOOK_NOT_VERIFIED);
    }
    const parsed = webhookEvent.safeParse(parseJson(rawBody));
    if (!parsed.success) {
      // Signed, but in a form we don't know: sending it again won't help.
      this.logger.error('A Razorpay webhook came in a form we do not know');
      return;
    }
    const { event, payload } = parsed.data;
    try {
      if (PAYMENT_EVENTS.has(event) && payload.payment) {
        const settlement = await this.orderPayments.settle(
          payload.payment.entity.id,
        );
        this.logger.info(
          { event, settlement: settlement.kind },
          'A Razorpay webhook was handled',
        );
      } else if (REFUND_EVENTS.has(event) && payload.refund) {
        const refund = payload.refund.entity;
        await this.payments.refundChanged({
          razorpayRefundId: refund.id,
          receipt: refund.receipt ?? null,
          status: refund.status,
        });
      }
    } catch (error) {
      if (error instanceof RazorpayError) {
        this.logger.error(
          { status: error.status, code: error.code },
          'Razorpay could not be asked about a webhook',
        );
        throw new RetryLaterException(
          503,
          PAYMENTS_UNAVAILABLE,
          'PAYMENTS_UNAVAILABLE',
          RETRY_WEBHOOK_SECONDS,
        );
      }
      throw error;
    }
  }
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}
