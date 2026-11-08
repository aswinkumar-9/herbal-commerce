import { BadRequestException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import type { PaymentsService } from '../payments/payments.service';
import { RazorpayError } from '../payments/razorpay.gateway';
import type { OrderPaymentsService } from './order-payments.service';
import { RazorpayWebhooksService } from './razorpay-webhooks.service';

const PAYMENT_ID = 'pay_G3P9vcIhRs3NV4';
const REFUND_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';

function body(event: object): Buffer {
  return Buffer.from(JSON.stringify(event));
}

function paymentEvent(event: string): Buffer {
  return body({
    entity: 'event',
    account_id: 'acc_Fake00000001',
    event,
    contains: ['payment'],
    payload: {
      payment: {
        entity: { id: PAYMENT_ID, amount: 49_800, status: 'captured' },
      },
    },
    created_at: 1_762_500_000,
  });
}

function refundEvent(event: string, status: string): Buffer {
  return body({
    entity: 'event',
    event,
    contains: ['refund', 'payment'],
    payload: {
      refund: {
        entity: {
          id: 'rfnd_FP8QHiV938haTz',
          payment_id: PAYMENT_ID,
          receipt: REFUND_ID,
          status,
        },
      },
      payment: { entity: { id: PAYMENT_ID } },
    },
  });
}

function setup() {
  const payments = {
    isWebhookSignatureValid: jest.fn().mockReturnValue(true),
    refundChanged: jest.fn().mockResolvedValue(undefined),
  };
  const orderPayments = {
    settle: jest.fn().mockResolvedValue({ kind: 'PAID', orderId: 'o1' }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new RazorpayWebhooksService(
    payments as unknown as PaymentsService,
    orderPayments as unknown as OrderPaymentsService,
    logger as unknown as PinoLogger,
  );
  return { service, payments, orderPayments, logger };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

describe('RazorpayWebhooksService.receive', () => {
  it('checks the signature over the body exactly as it arrived', async () => {
    const { service, payments } = setup();
    const raw = paymentEvent('payment.captured');

    await service.receive(raw, 'signature');

    expect(payments.isWebhookSignatureValid).toHaveBeenCalledWith(
      raw,
      'signature',
    );
  });

  it('refuses a webhook without a body or with a wrong signature, doing nothing', async () => {
    for (const [raw, valid] of [
      [undefined, true],
      [paymentEvent('payment.captured'), false],
    ] as const) {
      const { service, payments, orderPayments, logger } = setup();
      payments.isWebhookSignatureValid.mockReturnValueOnce(valid);

      const error = await refusal(service.receive(raw, 'signature'));

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(
        'The webhook could not be verified.',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'A Razorpay webhook came with a wrong signature',
      );
      expect(orderPayments.settle).not.toHaveBeenCalled();
    }
  });

  it("settles the payment a payment webhook names, on Razorpay's own word", async () => {
    for (const event of [
      'payment.authorized',
      'payment.captured',
      'payment.failed',
      'order.paid',
    ]) {
      const { service, orderPayments, logger } = setup();

      await service.receive(paymentEvent(event), 'signature');

      expect(orderPayments.settle).toHaveBeenCalledWith(PAYMENT_ID);
      expect(logger.info).toHaveBeenCalledWith(
        { event, settlement: 'PAID' },
        'A Razorpay webhook was handled',
      );
    }
  });

  it('moves a refund forward from a refund webhook', async () => {
    for (const [event, status] of [
      ['refund.created', 'pending'],
      ['refund.processed', 'processed'],
      ['refund.failed', 'failed'],
    ]) {
      const { service, payments, orderPayments } = setup();

      await service.receive(refundEvent(event, status), 'signature');

      expect(payments.refundChanged).toHaveBeenCalledWith({
        razorpayRefundId: 'rfnd_FP8QHiV938haTz',
        receipt: REFUND_ID,
        status,
      });
      expect(orderPayments.settle).not.toHaveBeenCalled();
    }
  });

  it('ignores other events', async () => {
    const { service, payments, orderPayments } = setup();

    await service.receive(paymentEvent('payment.downtime.started'), 'sig');
    await service.receive(
      refundEvent('refund.speed_changed', 'pending'),
      'sig',
    );

    expect(orderPayments.settle).not.toHaveBeenCalled();
    expect(payments.refundChanged).not.toHaveBeenCalled();
  });

  it('logs a signed webhook in a form it does not know, and answers so Razorpay stops sending it', async () => {
    for (const raw of [
      Buffer.from('not json'),
      body({ event: 'payment.captured' }),
      body({
        event: 'payment.captured',
        payload: { payment: { entity: { id: '../orders' } } },
      }),
    ]) {
      const { service, orderPayments, logger } = setup();

      await expect(service.receive(raw, 'signature')).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'A Razorpay webhook came in a form we do not know',
      );
      expect(orderPayments.settle).not.toHaveBeenCalled();
    }
  });

  it('asks Razorpay to send it again later when Razorpay cannot be asked', async () => {
    const { service, orderPayments, logger } = setup();
    orderPayments.settle.mockRejectedValueOnce(
      new RazorpayError(503, null, 'Razorpay answered 503'),
    );

    const error = await refusal(
      service.receive(paymentEvent('payment.captured'), 'signature'),
    );

    expect(error).toBeInstanceOf(RetryLaterException);
    const busy = error as RetryLaterException;
    expect([busy.getStatus(), busy.retryAfterSeconds]).toEqual([503, 30]);
    expect(logger.error).toHaveBeenCalledWith(
      { status: 503, code: null },
      'Razorpay could not be asked about a webhook',
    );
  });

  it('passes any other failure on, so Razorpay sends it again', async () => {
    const { service, payments } = setup();
    const failure = new Error('the database is down');
    payments.refundChanged.mockRejectedValueOnce(failure);

    await expect(
      service.receive(refundEvent('refund.processed', 'processed'), 'sig'),
    ).rejects.toBe(failure);
  });
});
