import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import {
  RazorpayError,
  RazorpayGateway,
  toPaise,
  toRupees,
} from './razorpay.gateway';

// Made-up keys. The signatures and the sign-in below were worked out once
// with Node's own HMAC and base64, apart from this code.
const KEY_ID = 'rzp_test_FakeKey0123';
const KEY_SECRET = 'TestKeySecretFake0123456';
const WEBHOOK_SECRET = 'webhookSecretForTestsOnly-0123456789_abcdefXYZ';
const BASIC =
  'Basic cnpwX3Rlc3RfRmFrZUtleTAxMjM6VGVzdEtleVNlY3JldEZha2UwMTIzNDU2';
const ORDER_ID = 'order_RB58MiP5SPFYyM';
const PAYMENT_ID = 'pay_G3P9vcIhRs3NV4';
// HMAC-SHA256 of "order_RB58MiP5SPFYyM|pay_G3P9vcIhRs3NV4" with KEY_SECRET.
const CHECKOUT_SIGNATURE =
  '2fe297ba8d4585a8ecb4e852d6603baf5e5aac841d17c54584d715a588538d9a';
const WEBHOOK_BODY = '{"entity":"event","event":"payment.captured"}';
// HMAC-SHA256 of WEBHOOK_BODY with WEBHOOK_SECRET.
const WEBHOOK_SIGNATURE =
  'a9d6f34bf225d35769819af9319e82097a9d3299dcce4e2320e01617b3a84774';
const REFUND_RECEIPT = '0b1e7c52-9a4d-4f3e-8c21-5d6e7f8a9b0c';

const order = {
  id: ORDER_ID,
  entity: 'order',
  amount: 49_800,
  amount_paid: 0,
  amount_due: 49_800,
  currency: 'INR',
  receipt: '7KQ2M9XDPA',
  status: 'created',
  attempts: 0,
  notes: { orderId: '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30' },
  created_at: 1_762_500_000,
};

const payment = {
  id: PAYMENT_ID,
  entity: 'payment',
  amount: 49_800,
  amount_refunded: 0,
  currency: 'INR',
  status: 'captured',
  order_id: ORDER_ID,
  method: 'upi',
  captured: true,
};

function answer(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });
}

function gateway(): RazorpayGateway {
  const settings: Record<string, string> = {
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };
  return new RazorpayGateway({
    get: (key: string) => settings[key],
  } as unknown as ConfigService<Env, true>);
}

async function failure(promise: Promise<unknown>): Promise<RazorpayError> {
  try {
    await promise;
  } catch (error) {
    return error as RazorpayError;
  }
  throw new Error('expected a failure');
}

describe('toPaise and toRupees', () => {
  it('turn rupees into paise for Razorpay, and back only when whole', () => {
    expect(toPaise(498)).toBe(49_800);
    expect(toRupees(49_800)).toBe(498);
    expect(toRupees(0)).toBe(0);
    expect(toRupees(49_850)).toBeNull();
    expect(toRupees(49_801)).toBeNull();
  });
});

describe('RazorpayGateway', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  function request(index = 0): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return { url, init };
  }

  it('gives the app the key ID, which is not secret', () => {
    expect(gateway().keyId).toBe(KEY_ID);
  });

  describe('createOrder', () => {
    it('creates an order in paise, with our receipt and notes, signed in with the key', async () => {
      fetchMock.mockResolvedValue(answer(200, order));

      await expect(
        gateway().createOrder({
          amountRupees: 498,
          receipt: '7KQ2M9XDPA',
          notes: { orderId: order.notes.orderId },
        }),
      ).resolves.toEqual({
        id: ORDER_ID,
        amountRupees: 498,
        currency: 'INR',
        receipt: '7KQ2M9XDPA',
        status: 'created',
      });

      const { url, init } = request();
      expect(url).toBe('https://api.razorpay.com/v1/orders');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        Authorization: BASIC,
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init.body as string)).toEqual({
        amount: 49_800,
        currency: 'INR',
        receipt: '7KQ2M9XDPA',
        notes: { orderId: order.notes.orderId },
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('refuses an amount that is not whole rupees, or a bad receipt, without calling Razorpay', async () => {
      for (const amountRupees of [498.5, 0, -49]) {
        await expect(
          gateway().createOrder({ amountRupees, receipt: 'R1', notes: {} }),
        ).rejects.toThrow('A Razorpay order is for a whole number of rupees');
      }
      for (const receipt of ['', 'x'.repeat(41), 'two words', 'ref/1']) {
        await expect(
          gateway().createOrder({ amountRupees: 498, receipt, notes: {} }),
        ).rejects.toThrow('Not a receipt Razorpay takes');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('findOrderByReceipt', () => {
    it('finds the order with exactly this receipt', async () => {
      fetchMock.mockResolvedValue(
        answer(200, {
          entity: 'collection',
          count: 2,
          items: [
            { ...order, id: 'order_Other1', receipt: '7KQ2M9XDPAX' },
            { ...order, id: 'order_Exact1' },
          ],
        }),
      );

      const found = await gateway().findOrderByReceipt('7KQ2M9XDPA');

      expect(found?.id).toBe('order_Exact1');
      const { url, init } = request();
      expect(url).toBe('https://api.razorpay.com/v1/orders?receipt=7KQ2M9XDPA');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(init.headers).toEqual({ Authorization: BASIC });
    });

    it('answers null when no order has it', async () => {
      fetchMock.mockResolvedValue(
        answer(200, { entity: 'collection', count: 0, items: [] }),
      );

      await expect(
        gateway().findOrderByReceipt('7KQ2M9XDPA'),
      ).resolves.toBeNull();
    });

    it('refuses a bad receipt without calling Razorpay', async () => {
      await expect(gateway().findOrderByReceipt('a&b=c')).rejects.toThrow(
        'Not a receipt Razorpay takes',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('fetchPayment', () => {
    it('reads a payment, in rupees', async () => {
      // Part of it refunded, so the two amounts differ.
      fetchMock.mockResolvedValue(
        answer(200, { ...payment, amount_refunded: 20_000 }),
      );

      await expect(gateway().fetchPayment(PAYMENT_ID)).resolves.toEqual({
        id: PAYMENT_ID,
        orderId: ORDER_ID,
        amountRupees: 498,
        refundedRupees: 200,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
      });
      const { url, init } = request();
      expect(url).toBe(`https://api.razorpay.com/v1/payments/${PAYMENT_ID}`);
      expect(init.method).toBe('GET');
    });

    it('marks an amount with paise as matching no order', async () => {
      fetchMock.mockResolvedValue(answer(200, { ...payment, amount: 49_850 }));

      const found = await gateway().fetchPayment(PAYMENT_ID);

      expect(found.amountRupees).toBeNull();
    });

    it('refuses an ID that is not a payment ID, without calling Razorpay', async () => {
      for (const id of [
        '../orders',
        'pay_',
        ORDER_ID,
        'pay_abc/def',
        'pay_ab?x=1',
      ]) {
        await expect(gateway().fetchPayment(id)).rejects.toThrow(
          'Not a Razorpay ID',
        );
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('orderPayments', () => {
    it('lists every payment tried for an order', async () => {
      fetchMock.mockResolvedValue(
        answer(200, {
          entity: 'collection',
          count: 2,
          items: [
            { ...payment, id: 'pay_Failed1', status: 'failed', method: null },
            payment,
          ],
        }),
      );

      const payments = await gateway().orderPayments(ORDER_ID);

      expect(payments.map((p) => [p.id, p.status, p.method])).toEqual([
        ['pay_Failed1', 'failed', null],
        [PAYMENT_ID, 'captured', 'upi'],
      ]);
      expect(request().url).toBe(
        `https://api.razorpay.com/v1/orders/${ORDER_ID}/payments`,
      );
    });

    it('refuses an ID that is not an order ID, without calling Razorpay', async () => {
      for (const id of [PAYMENT_ID, '../payments', 'order_a/b']) {
        await expect(gateway().orderPayments(id)).rejects.toThrow(
          'Not a Razorpay ID',
        );
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('refunds a payment in full, once per receipt', async () => {
      fetchMock.mockResolvedValue(
        answer(200, {
          id: 'rfnd_FP8QHiV938haTz',
          entity: 'refund',
          amount: 49_800,
          currency: 'INR',
          payment_id: PAYMENT_ID,
          receipt: REFUND_RECEIPT,
          status: 'pending',
          speed_requested: 'normal',
        }),
      );

      await expect(
        gateway().refund(PAYMENT_ID, REFUND_RECEIPT),
      ).resolves.toEqual({
        id: 'rfnd_FP8QHiV938haTz',
        paymentId: PAYMENT_ID,
        amountRupees: 498,
        status: 'pending',
      });
      const { url, init } = request();
      expect(url).toBe(
        `https://api.razorpay.com/v1/payments/${PAYMENT_ID}/refund`,
      );
      expect(init.method).toBe('POST');
      // No amount: Razorpay then refunds all of it.
      expect(JSON.parse(init.body as string)).toEqual({
        receipt: REFUND_RECEIPT,
      });
    });

    it('refuses a bad payment ID or receipt without calling Razorpay', async () => {
      await expect(gateway().refund('../x', REFUND_RECEIPT)).rejects.toThrow(
        'Not a Razorpay ID',
      );
      await expect(gateway().refund(PAYMENT_ID, 'a b')).rejects.toThrow(
        'Not a receipt Razorpay takes',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('when a call fails', () => {
    it("reports Razorpay's own error, and never the keys", async () => {
      fetchMock.mockResolvedValue(
        answer(400, {
          error: {
            code: 'BAD_REQUEST_ERROR',
            description: 'The id provided does not exist',
            source: 'business',
            step: 'payment_initiation',
            reason: 'input_validation_failed',
            metadata: {},
          },
        }),
      );

      const error = await failure(gateway().fetchPayment(PAYMENT_ID));

      expect(error).toBeInstanceOf(RazorpayError);
      expect(error.status).toBe(400);
      expect(error.code).toBe('BAD_REQUEST_ERROR');
      expect(error.message).toBe('The id provided does not exist');
      const shown = [
        error.message,
        String(error.stack),
        JSON.stringify(Object.entries(error)),
      ].join(' ');
      expect(shown).not.toContain(KEY_SECRET);
      expect(shown).not.toContain(BASIC.slice(6));
    });

    it('reports an answer that is not JSON by its status', async () => {
      fetchMock.mockResolvedValue(answer(502, '<html>Bad gateway</html>'));

      const error = await failure(gateway().fetchPayment(PAYMENT_ID));

      expect([error.status, error.code, error.message]).toEqual([
        502,
        null,
        'Razorpay answered 502',
      ]);
    });

    it('treats an answer of another form as an error, never a guess', async () => {
      for (const body of [
        { id: ORDER_ID },
        { ...payment, status: 'settled' },
        { ...payment, amount: '49800' },
        { ...payment, id: 'pay_../x' },
        'not json',
      ]) {
        fetchMock.mockResolvedValueOnce(answer(200, body));
        const error = await failure(gateway().fetchPayment(PAYMENT_ID));
        expect([error.status, error.code]).toEqual([200, 'UNEXPECTED_ANSWER']);
      }
    });

    it('reports Razorpay as unreachable when the network fails or is too slow', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      fetchMock.mockRejectedValueOnce(
        new DOMException('The operation timed out.', 'TimeoutError'),
      );
      fetchMock.mockResolvedValueOnce({
        status: 200,
        text: () => Promise.reject(new Error('terminated')),
      } as unknown as Response);

      for (let i = 0; i < 3; i++) {
        const error = await failure(gateway().fetchPayment(PAYMENT_ID));
        expect(error).toBeInstanceOf(RazorpayError);
        expect([error.status, error.code, error.message]).toEqual([
          null,
          null,
          'Razorpay could not be reached',
        ]);
      }
    });
  });

  describe('signatures', () => {
    it("accepts the payment page's signature only for its own order and payment", () => {
      const g = gateway();
      expect(
        g.isCheckoutSignatureValid(ORDER_ID, PAYMENT_ID, CHECKOUT_SIGNATURE),
      ).toBe(true);
      expect(
        g.isCheckoutSignatureValid(
          ORDER_ID,
          PAYMENT_ID,
          CHECKOUT_SIGNATURE.toUpperCase(),
        ),
      ).toBe(true);
      // The other way round, another payment, another order.
      expect(
        g.isCheckoutSignatureValid(PAYMENT_ID, ORDER_ID, CHECKOUT_SIGNATURE),
      ).toBe(false);
      expect(
        g.isCheckoutSignatureValid(ORDER_ID, 'pay_Other1', CHECKOUT_SIGNATURE),
      ).toBe(false);
      expect(
        g.isCheckoutSignatureValid(
          'order_Other1',
          PAYMENT_ID,
          CHECKOUT_SIGNATURE,
        ),
      ).toBe(false);
      // Signed with the webhook secret instead of the key secret.
      const withWebhookSecret = createHmac('sha256', WEBHOOK_SECRET)
        .update(`${ORDER_ID}|${PAYMENT_ID}`)
        .digest('hex');
      expect(
        g.isCheckoutSignatureValid(ORDER_ID, PAYMENT_ID, withWebhookSecret),
      ).toBe(false);
      for (const signature of [
        undefined,
        '',
        CHECKOUT_SIGNATURE.slice(0, 63),
        `${CHECKOUT_SIGNATURE}0`,
        `z${CHECKOUT_SIGNATURE.slice(1)}`,
      ]) {
        expect(
          g.isCheckoutSignatureValid(ORDER_ID, PAYMENT_ID, signature),
        ).toBe(false);
      }
    });

    it('accepts a webhook only with the signature of its exact body', () => {
      const g = gateway();
      const raw = Buffer.from(WEBHOOK_BODY);
      expect(g.isWebhookSignatureValid(raw, WEBHOOK_SIGNATURE)).toBe(true);
      // The same JSON written again, with spaces: no longer the same bytes.
      const rewritten = Buffer.from(
        JSON.stringify(JSON.parse(WEBHOOK_BODY), null, 1),
      );
      expect(g.isWebhookSignatureValid(rewritten, WEBHOOK_SIGNATURE)).toBe(
        false,
      );
      // Signed with the key secret instead of the webhook secret.
      const withKeySecret = createHmac('sha256', KEY_SECRET)
        .update(raw)
        .digest('hex');
      expect(g.isWebhookSignatureValid(raw, withKeySecret)).toBe(false);
      expect(g.isWebhookSignatureValid(raw, undefined)).toBe(false);
      expect(g.isWebhookSignatureValid(raw, 'nothex')).toBe(false);
    });
  });
});
