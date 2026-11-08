import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../config/env';

const API = 'https://api.razorpay.com/v1';
// A call that takes longer than this counts as failed.
const TIMEOUT_MS = 10_000;

// Razorpay's IDs: a prefix, then letters and digits. An ID that comes from a
// client is checked against these before it goes into an address.
export const RAZORPAY_ORDER_ID = /^order_[A-Za-z0-9]{1,40}$/;
export const RAZORPAY_PAYMENT_ID = /^pay_[A-Za-z0-9]{1,40}$/;
const RAZORPAY_REFUND_ID = /^rfnd_[A-Za-z0-9]{1,40}$/;
// A receipt: our own reference for an order or a refund, at most 40
// characters.
const RECEIPT = /^[A-Za-z0-9_-]{1,40}$/;

// Razorpay counts money in paise, the shop in whole rupees (ADR 0026). By the
// owner's choice, these two are the only places where they meet (ADR 0027).
export function toPaise(rupees: number): number {
  return rupees * 100;
}

// Whole rupees, or null for an amount with paise: no order ever comes to
// that, so it can never match one.
export function toRupees(paise: number): number | null {
  return paise % 100 === 0 ? paise / 100 : null;
}

const ORDER_STATUSES = ['created', 'attempted', 'paid'] as const;
const PAYMENT_STATUSES = [
  'created',
  'authorized',
  'captured',
  'refunded',
  'failed',
] as const;
const REFUND_STATUSES = ['pending', 'processed', 'failed'] as const;

// What Razorpay answers, checked before it is used: an answer of another
// form is an error, never a guess.
const orderAnswer = z.object({
  id: z.string().regex(RAZORPAY_ORDER_ID),
  amount: z.number().int(),
  currency: z.string(),
  receipt: z.string().nullish(),
  status: z.enum(ORDER_STATUSES),
});
const paymentAnswer = z.object({
  id: z.string().regex(RAZORPAY_PAYMENT_ID),
  order_id: z.string().nullable(),
  amount: z.number().int(),
  amount_refunded: z.number().int(),
  currency: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  method: z.string().nullish(),
});
const refundAnswer = z.object({
  id: z.string().regex(RAZORPAY_REFUND_ID),
  payment_id: z.string(),
  amount: z.number().int(),
  status: z.enum(REFUND_STATUSES),
});
const listOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item) });

// A Razorpay order: what one payment is for.
export interface RazorpayOrder {
  id: string;
  amountRupees: number | null;
  currency: string;
  receipt: string | null;
  status: (typeof ORDER_STATUSES)[number];
}

// A payment as Razorpay knows it. Only a captured one has the money.
export interface RazorpayPayment {
  id: string;
  orderId: string | null;
  amountRupees: number | null;
  refundedRupees: number | null;
  currency: string;
  status: (typeof PAYMENT_STATUSES)[number];
  method: string | null;
}

export interface RazorpayRefund {
  id: string;
  paymentId: string;
  amountRupees: number | null;
  status: (typeof REFUND_STATUSES)[number];
}

// A call to Razorpay that failed: Razorpay said no, answered in a form we
// don't know, or could not be reached in time. It keeps only Razorpay's
// status, code and description, never the request or the keys.
export class RazorpayError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
    description: string,
  ) {
    super(description);
    this.name = 'RazorpayError';
  }
}

// The only way to Razorpay (ADR 0027): its REST API over HTTPS, without its
// library, and its signatures. Everything here speaks rupees.
@Injectable()
export class RazorpayGateway {
  // Not secret: the app opens Razorpay's payment page with it.
  readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly authorization: string;

  constructor(config: ConfigService<Env, true>) {
    this.keyId = config.get('RAZORPAY_KEY_ID', { infer: true });
    this.keySecret = config.get('RAZORPAY_KEY_SECRET', { infer: true });
    this.webhookSecret = config.get('RAZORPAY_WEBHOOK_SECRET', {
      infer: true,
    });
    this.authorization = `Basic ${Buffer.from(
      `${this.keyId}:${this.keySecret}`,
    ).toString('base64')}`;
  }

  // A new Razorpay order for an amount in rupees. Razorpay refuses a second
  // order with the same receipt, so one of ours can never get two.
  async createOrder(input: {
    amountRupees: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder> {
    if (!Number.isInteger(input.amountRupees) || input.amountRupees < 1) {
      throw new Error('A Razorpay order is for a whole number of rupees');
    }
    if (!RECEIPT.test(input.receipt)) {
      throw new Error('Not a receipt Razorpay takes');
    }
    const answer = await this.call('POST', '/orders', orderAnswer, {
      amount: toPaise(input.amountRupees),
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes,
    });
    return razorpayOrder(answer);
  }

  // The Razorpay order with exactly this receipt, or null. It finds an order
  // whose creation answered too late to be saved.
  async findOrderByReceipt(receipt: string): Promise<RazorpayOrder | null> {
    if (!RECEIPT.test(receipt)) {
      throw new Error('Not a receipt Razorpay takes');
    }
    const answer = await this.call(
      'GET',
      `/orders?receipt=${encodeURIComponent(receipt)}`,
      listOf(orderAnswer),
    );
    const found = answer.items.find((order) => order.receipt === receipt);
    return found ? razorpayOrder(found) : null;
  }

  // One payment, as Razorpay knows it now.
  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    checkId(RAZORPAY_PAYMENT_ID, paymentId);
    const answer = await this.call(
      'GET',
      `/payments/${paymentId}`,
      paymentAnswer,
    );
    return razorpayPayment(answer);
  }

  // Every payment tried for a Razorpay order, failed ones included.
  async orderPayments(orderId: string): Promise<RazorpayPayment[]> {
    checkId(RAZORPAY_ORDER_ID, orderId);
    const answer = await this.call(
      'GET',
      `/orders/${orderId}/payments`,
      listOf(paymentAnswer),
    );
    return answer.items.map(razorpayPayment);
  }

  // Gives a captured payment back in full. The receipt is ours: Razorpay
  // refuses a second refund with the same one, so a retry refunds once.
  async refund(paymentId: string, receipt: string): Promise<RazorpayRefund> {
    checkId(RAZORPAY_PAYMENT_ID, paymentId);
    if (!RECEIPT.test(receipt)) {
      throw new Error('Not a receipt Razorpay takes');
    }
    const answer = await this.call(
      'POST',
      `/payments/${paymentId}/refund`,
      refundAnswer,
      { receipt },
    );
    return {
      id: answer.id,
      paymentId: answer.payment_id,
      amountRupees: toRupees(answer.amount),
      status: answer.status,
    };
  }

  // Whether the payment page's answer is really Razorpay's: an HMAC-SHA256,
  // with the key secret, of our Razorpay order ID, "|" and the payment ID.
  isCheckoutSignatureValid(
    orderId: string,
    paymentId: string,
    signature: string | undefined,
  ): boolean {
    const expected = createHmac('sha256', this.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest();
    return sameSignature(expected, signature);
  }

  // Whether a webhook is really Razorpay's: an HMAC-SHA256, with our webhook
  // secret, of the body exactly as it arrived. A body read as JSON and
  // written again would not match.
  isWebhookSignatureValid(
    rawBody: Buffer,
    signature: string | undefined,
  ): boolean {
    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest();
    return sameSignature(expected, signature);
  }

  private async call<T extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    answer: T,
    body?: unknown,
  ): Promise<z.infer<T>> {
    let status: number;
    let text: string;
    // A body only with a POST: a GET never has one.
    const sent: { headers: Record<string, string>; body?: string } =
      body === undefined
        ? { headers: { Authorization: this.authorization } }
        : {
            headers: {
              Authorization: this.authorization,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          };
    try {
      const response = await fetch(`${API}${path}`, {
        method,
        ...sent,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      text = await response.text();
    } catch {
      throw new RazorpayError(null, null, 'Razorpay could not be reached');
    }
    const json = parseJson(text);
    if (status < 200 || status > 299) {
      const error = (json as { error?: Record<string, unknown> } | null)?.error;
      throw new RazorpayError(
        status,
        typeof error?.code === 'string' ? error.code : null,
        typeof error?.description === 'string'
          ? error.description
          : `Razorpay answered ${status}`,
      );
    }
    const parsed = answer.safeParse(json);
    if (!parsed.success) {
      throw new RazorpayError(
        status,
        'UNEXPECTED_ANSWER',
        'Razorpay answered in a form we do not know',
      );
    }
    return parsed.data;
  }
}

function checkId(pattern: RegExp, id: string): void {
  if (!pattern.test(id)) {
    throw new Error('Not a Razorpay ID');
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Compares in constant time, so the time taken says nothing about how much
// of a forged signature was right. Razorpay sends hex.
function sameSignature(expected: Buffer, signature: string | undefined) {
  if (signature === undefined || !/^[0-9a-fA-F]{64}$/.test(signature)) {
    return false;
  }
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function razorpayOrder(answer: z.infer<typeof orderAnswer>): RazorpayOrder {
  return {
    id: answer.id,
    amountRupees: toRupees(answer.amount),
    currency: answer.currency,
    receipt: answer.receipt ?? null,
    status: answer.status,
  };
}

function razorpayPayment(
  answer: z.infer<typeof paymentAnswer>,
): RazorpayPayment {
  return {
    id: answer.id,
    orderId: answer.order_id,
    amountRupees: toRupees(answer.amount),
    refundedRupees: toRupees(answer.amount_refunded),
    currency: answer.currency,
    status: answer.status,
    method: answer.method ?? null,
  };
}
