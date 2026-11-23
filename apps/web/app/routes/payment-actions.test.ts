// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_HOLD_OVER } from '../orders.server.ts';
import {
  RAZORPAY_KEY_ID,
  RAZORPAY_ORDER_ID,
  RAZORPAY_PAYMENT_ID,
  RAZORPAY_SIGNATURE,
  checkoutFields,
} from '../razorpay.ts';
import type { CustomerSession } from '../session.server.ts';
import { answer, contextWith, outcome } from '../test/route-calls.ts';
import { loader as orderLoader } from './order.tsx';
import { loader as paymentLoader } from './order-payment.tsx';

// Paying for an order on Razorpay's own page, and confirming the payment
// when the customer is back (part 14C, ADR 0042), against a stand-in for
// the API.
const SITE = 'http://localhost:3001';
const API = 'http://127.0.0.1:3000/v1';
const SIGNED_IN: CustomerSession = {
  accessToken: 'access.jwt.one',
  refreshToken: 'refresh-token-one-0123456789',
  accessEndsAt: Date.now() + 10 * 60_000,
  endsAt: Date.now() + 20 * 24 * 60 * 60_000,
};
const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const PAYMENT_ID = 'pay_G3P9vcIhRs3NV4';
const SIGNATURE = 'a'.repeat(64);
const ORDER = {
  id: ORDER_ID,
  reference: '7KQ2M9XDPA',
  status: 'PENDING_PAYMENT',
  holdExpiresAt: '2026-11-07T14:57:38.771Z',
  createdAt: '2026-11-07T14:42:38.771Z',
  packedAt: null,
  shippedAt: null,
  courierName: null,
  trackingNumber: null,
  deliveredAt: null,
  itemsTotalRupees: 449,
  itemsGstRupees: 21,
  deliveryChargeRupees: 49,
  totalRupees: 498,
  items: [
    {
      sku: 'ASH-CAP-60',
      productName: 'Ashwagandha Capsules',
      quantity: 60,
      unit: 'CAPSULES',
      packs: 1,
      mrpRupees: 500,
      priceRupees: 449,
      gstRate: 5,
      lineTotalRupees: 449,
      gstRupees: 21,
    },
  ],
  delivery: {
    fullName: 'Asha Verma',
    phone: '9845012345',
    line1: '12 MG Road',
    line2: null,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  },
  payment: null,
};
const START = {
  reference: '7KQ2M9XDPA',
  totalRupees: 498,
  holdExpiresAt: '2026-11-07T14:57:38.771Z',
  razorpayKeyId: 'rzp_test_ABCDEFGHijkl01',
  razorpayOrderId: 'order_RB58MiP5SPFYyM',
};
const ME = { fullName: 'Asha Verma', email: 'asha@example.com' };

const fetchMock = vi.fn<typeof fetch>();
const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method ?? 'GET',
    body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
  }));
function api(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`;
    const route = routes[key];
    if (!route) {
      throw new Error(`not expected: ${key}`);
    }
    return route();
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Run = (args: never) => unknown;
function call(
  run: Run,
  url: string,
  {
    id = ORDER_ID,
    session = SIGNED_IN,
  }: { id?: string; session?: CustomerSession | null } = {},
) {
  const { context } = contextWith(session);
  return outcome(() =>
    run({
      request: new Request(`${SITE}${url}`),
      context,
      params: { id },
    } as never),
  );
}

describe('an order waiting for payment', () => {
  const open = (
    url = `/orders/${ORDER_ID}`,
    start = () => answer(200, START),
    me = () => answer(200, ME),
  ) => {
    api({
      [`GET /v1/me/orders/${ORDER_ID}`]: () => answer(200, ORDER),
      [`POST /v1/me/orders/${ORDER_ID}/payment`]: start,
      'GET /v1/me': me,
    });
    return call(orderLoader as Run, url);
  };

  it('starts its payment with the API, and gives Razorpay’s page what it needs', async () => {
    const { data } = await open();
    expect(data).toMatchObject({
      pay: {
        totalRupees: 498,
        fields: {
          key_id: 'rzp_test_ABCDEFGHijkl01',
          order_id: 'order_RB58MiP5SPFYyM',
          amount: '49800',
          currency: 'INR',
          name: 'Herbal Commerce',
          description: 'Order 7KQ2M9XDPA',
          'prefill[email]': 'asha@example.com',
          'prefill[contact]': '+919845012345',
          callback_url: `${SITE}/orders/${ORDER_ID}/payment`,
          cancel_url: `${SITE}/orders/${ORDER_ID}?payment=cancelled`,
        },
      },
      payProblem: null,
      payWait: null,
      returned: null,
    });
    expect(sent()).toEqual(
      expect.arrayContaining([
        {
          url: `${API}/me/orders/${ORDER_ID}/payment`,
          method: 'POST',
          body: undefined,
        },
      ]),
    );
  });

  it('says what happened back from Razorpay’s page, and nothing for any other word', async () => {
    for (const [asked, returned] of [
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
      ['checking', 'checking'],
      ['unverified', 'unverified'],
      ['paid', null],
      ['__proto__', null],
      ['toString', null],
    ] as const) {
      const { data } = await open(`/orders/${ORDER_ID}?payment=${asked}`);
      expect([asked, (data as { returned: unknown }).returned]).toEqual([
        asked,
        returned,
      ]);
    }
  });

  it('when the time to pay is over, says so, and nothing of Razorpay’s page', async () => {
    const { data } = await open(`/orders/${ORDER_ID}?payment=failed`, () =>
      answer(409, { message: API_HOLD_OVER }),
    );
    expect(data).toMatchObject({
      pay: null,
      payProblem: 'over',
      returned: null,
    });
  });

  it('paid or ended a moment ago: says the order changed', async () => {
    const { data } = await open(undefined, () =>
      answer(409, {
        message: 'Only an order waiting for payment can be paid.',
      }),
    );
    expect(data).toMatchObject({ pay: null, payProblem: 'changed' });
  });

  it('when payments can’t start now, says so; after too many tries, how long to wait', async () => {
    expect(
      (await open(undefined, () => answer(503, { message: 'x' }))).data,
    ).toMatchObject({ pay: null, payProblem: 'resting', payWait: null });
    expect(
      (
        await open(undefined, () =>
          answer(429, { message: 'x' }, { 'retry-after': '300' }),
        )
      ).data,
    ).toMatchObject({
      pay: null,
      payProblem: 'resting',
      payWait: 'Too many tries. Please wait 5 minutes and try again.',
    });
    // Without the customer's email, Razorpay's page can't be filled in.
    expect(
      (await open(undefined, undefined, () => answer(503, { message: 'x' })))
        .data,
    ).toMatchObject({ pay: null, payProblem: 'resting' });
  });

  it('gone a moment ago is “not found”', async () => {
    expect(
      await open(undefined, () => answer(404, { message: 'Order not found' })),
    ).toMatchObject({ status: 404 });
  });
});

describe('an order not waiting for payment', () => {
  it('starts no payment, and says nothing of Razorpay’s page', async () => {
    api({
      [`GET /v1/me/orders/${ORDER_ID}`]: () =>
        answer(200, { ...ORDER, status: 'PAID' }),
    });
    const { data } = await call(
      orderLoader as Run,
      `/orders/${ORDER_ID}?payment=checking`,
    );
    expect(data).toMatchObject({ pay: null, payProblem: null, returned: null });
    expect(sent()).toHaveLength(1);
  });
});

describe('back from Razorpay’s page', () => {
  const back = `/orders/${ORDER_ID}/payment?payment=${PAYMENT_ID}&signature=${SIGNATURE}`;
  const confirm = (reply: () => Response) => {
    api({ [`POST /v1/me/orders/${ORDER_ID}/payment/confirm`]: reply });
    return call(paymentLoader as Run, back);
  };

  it('has the API confirm the payment, then shows the order, paid', async () => {
    expect(
      await confirm(() => answer(200, { ...ORDER, status: 'PAID' })),
    ).toMatchObject({ status: 302, location: `/orders/${ORDER_ID}` });
    expect(sent()).toEqual([
      {
        url: `${API}/me/orders/${ORDER_ID}/payment/confirm`,
        method: 'POST',
        body: { razorpayPaymentId: PAYMENT_ID, razorpaySignature: SIGNATURE },
      },
    ]);
  });

  it('with its money going back, shows the order, which says so', async () => {
    expect(
      await confirm(() => answer(200, { ...ORDER, status: 'EXPIRED' })),
    ).toMatchObject({ status: 302, location: `/orders/${ORDER_ID}` });
  });

  it('not captured yet, or Razorpay and the API out of reach: says to look again', async () => {
    for (const reply of [
      () => answer(200, ORDER),
      () => answer(503, { message: 'x' }),
      () => answer(429, { message: 'x' }),
    ]) {
      expect(await confirm(reply)).toMatchObject({
        status: 302,
        location: `/orders/${ORDER_ID}?payment=checking`,
      });
    }
  });

  it('a payment that could not be verified says so', async () => {
    for (const reply of [
      () => answer(400, { message: 'The payment could not be verified.' }),
      () => answer(409, { message: 'Start paying for this order first.' }),
    ]) {
      expect(await confirm(reply)).toMatchObject({
        status: 302,
        location: `/orders/${ORDER_ID}?payment=unverified`,
      });
    }
  });

  it('someone else’s order goes to its page, which says “not found”', async () => {
    expect(
      await confirm(() => answer(404, { message: 'Order not found' })),
    ).toMatchObject({ status: 302, location: `/orders/${ORDER_ID}` });
  });

  it('without a payment’s ID and signature, is a payment that did not go through, never asked of the API', async () => {
    for (const query of [
      '',
      `?payment=${PAYMENT_ID}`,
      `?signature=${SIGNATURE}`,
      `?payment=order_RB58MiP5SPFYyM&signature=${SIGNATURE}`,
      `?payment=${PAYMENT_ID}&signature=${'z'.repeat(64)}`,
      `?payment=${PAYMENT_ID}&signature=${SIGNATURE}0`,
      `?payment=${PAYMENT_ID}%0A&signature=${SIGNATURE}`,
    ]) {
      expect(
        await call(paymentLoader as Run, `/orders/${ORDER_ID}/payment${query}`),
      ).toMatchObject({
        status: 302,
        location: `/orders/${ORDER_ID}?payment=failed`,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an address no order could have goes to its page, which says “not found”', async () => {
    expect(
      await call(
        paymentLoader as Run,
        `/orders/7/payment?payment=${PAYMENT_ID}&signature=${SIGNATURE}`,
        { id: '7' },
      ),
    ).toMatchObject({ status: 302, location: '/orders/7' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a visitor signs in first, then comes back to confirm', async () => {
    expect(
      await call(paymentLoader as Run, back, { session: null }),
    ).toMatchObject({
      status: 302,
      location: `/sign-in?next=${encodeURIComponent(back)}`,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Razorpay’s page', () => {
  it('gets an Indian mobile number with its country code, and any other phone as it is', () => {
    const fields = (phone: string) =>
      checkoutFields({
        keyId: 'rzp_test_ABCDEFGHijkl01',
        razorpayOrderId: 'order_RB58MiP5SPFYyM',
        totalRupees: 1,
        shopName: 'Herbal Commerce',
        description: 'Order 7KQ2M9XDPA',
        email: 'asha@example.com',
        phone,
        origin: SITE,
        orderId: ORDER_ID,
      });
    expect(fields('9845012345')['prefill[contact]']).toBe('+919845012345');
    expect(fields('+919845012345')['prefill[contact]']).toBe('+919845012345');
    expect(fields('9845012345').amount).toBe('100');
  });

  it('is told what the API checks, as the API says it', () => {
    const api = (path: string) =>
      readFileSync(join(import.meta.dirname, '../../../api/src', path), 'utf8');
    expect(api('orders/order-rules.ts')).toContain(
      `export const HOLD_OVER =\n  '${API_HOLD_OVER}';`,
    );
    const gateway = api('payments/razorpay.gateway.ts');
    expect(gateway).toContain(
      `export const RAZORPAY_ORDER_ID = ${String(RAZORPAY_ORDER_ID)};`,
    );
    expect(gateway).toContain(
      `export const RAZORPAY_PAYMENT_ID = ${String(RAZORPAY_PAYMENT_ID)};`,
    );
    expect(api('config/env.ts')).toContain(`      ${String(RAZORPAY_KEY_ID)},`);
    expect(api('orders/orders.schemas.ts')).toContain(
      `      ${String(RAZORPAY_SIGNATURE)},`,
    );
  });
});
