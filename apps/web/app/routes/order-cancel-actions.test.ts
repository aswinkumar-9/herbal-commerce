// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tooMany } from '../form-checks.server.ts';
import type { CustomerSession } from '../session.server.ts';
import { answer, contextWith, outcome, post } from '../test/route-calls.ts';
import { action, loader, shouldRevalidate } from './order.tsx';

// Cancelling an order (part 14D), against a stand-in for the API.
const SITE = 'http://localhost:3001';
const API = 'http://127.0.0.1:3000/v1';
const SIGNED_IN: CustomerSession = {
  accessToken: 'access.jwt.one',
  refreshToken: 'refresh-token-one-0123456789',
  accessEndsAt: Date.now() + 10 * 60_000,
  endsAt: Date.now() + 20 * 24 * 60 * 60_000,
};
const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const ORDER = {
  id: ORDER_ID,
  reference: '7KQ2M9XDPA',
  status: 'PAID',
  holdExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
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
  payment: { paidAt: '2026-11-07T14:45:00.000Z', refunds: [] },
};

const fetchMock = vi.fn<typeof fetch>();
const sent = () =>
  fetchMock.mock.calls.map(
    ([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`,
  );
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

function send(
  intent: string,
  {
    id = ORDER_ID,
    session = SIGNED_IN,
  }: { id?: string; session?: CustomerSession | null } = {},
) {
  const { context } = contextWith(session);
  return outcome(() =>
    action({
      request: post(`${SITE}/orders/${id}`, { intent }),
      context,
      params: { id },
    } as never),
  );
}

function open(url: string, order: Record<string, unknown>) {
  api({
    [`GET /v1/me/orders/${ORDER_ID}`]: () => answer(200, order),
    [`POST /v1/me/orders/${ORDER_ID}/payment`]: () =>
      answer(409, {
        message: 'The time to pay for this order is over. Please order again.',
      }),
    'GET /v1/me': () =>
      answer(200, { fullName: 'Asha Verma', email: 'asha@example.com' }),
  });
  const { context } = contextWith(SIGNED_IN);
  return outcome(() =>
    loader({
      request: new Request(`${SITE}${url}`),
      context,
      params: { id: ORDER_ID },
    } as never),
  );
}

describe('cancelling an order', () => {
  it('“Cancel order” only asks once more: the API is not asked', async () => {
    expect(await send('cancel')).toMatchObject({
      status: 200,
      data: { confirming: true, problem: null, wait: null },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('“Yes, cancel it” asks the API, then goes to the order, saying it is cancelled', async () => {
    api({
      [`POST /v1/me/orders/${ORDER_ID}/cancel`]: () =>
        answer(200, { ...ORDER, status: 'CANCELLED' }),
    });
    expect(await send('cancelConfirmed')).toMatchObject({
      status: 302,
      location: `/orders/${ORDER_ID}?done=cancelled`,
    });
    expect(sent()).toEqual([`POST ${API}/me/orders/${ORDER_ID}/cancel`]);
  });

  it('says when the order can no longer be cancelled', async () => {
    api({
      [`POST /v1/me/orders/${ORDER_ID}/cancel`]: () =>
        answer(409, { message: 'This order can no longer be cancelled.' }),
    });
    expect(await send('cancelConfirmed')).toMatchObject({
      status: 409,
      data: { confirming: false, problem: 'late', wait: null },
    });
  });

  it('says to try again when the API can’t, with the wait after too many tries', async () => {
    api({
      [`POST /v1/me/orders/${ORDER_ID}/cancel`]: () =>
        answer(429, { code: 'RATE_LIMITED' }, { 'retry-after': '120' }),
    });
    expect(await send('cancelConfirmed')).toMatchObject({
      status: 429,
      data: { problem: 'resting', wait: tooMany(120) },
    });
    api({
      [`POST /v1/me/orders/${ORDER_ID}/cancel`]: () =>
        answer(503, { message: 'Server busy' }),
    });
    expect(await send('cancelConfirmed')).toMatchObject({
      status: 503,
      data: { problem: 'resting', wait: null },
    });
  });

  it('someone else’s order, or a made-up one, is “not found”; a made-up one never reaches the API', async () => {
    api({
      [`POST /v1/me/orders/${ORDER_ID}/cancel`]: () =>
        answer(404, { message: 'Order not found' }),
    });
    expect(await send('cancelConfirmed')).toMatchObject({ status: 404 });
    fetchMock.mockClear();
    expect(
      await send('cancelConfirmed', { id: '..%2F..%2Fstaff' }),
    ).toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a visitor to sign in first, and anything else is refused', async () => {
    expect(await send('cancelConfirmed', { session: null })).toMatchObject({
      status: 302,
      location: `/sign-in?next=${encodeURIComponent(`/orders/${ORDER_ID}`)}`,
    });
    expect(await send('pay')).toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the page asks for the order again after cancelling, even refused', () => {
    const args = (actionStatus: number | undefined) =>
      ({ actionStatus, defaultShouldRevalidate: false }) as never;
    expect(shouldRevalidate(args(409))).toBe(true);
    expect(shouldRevalidate(args(200))).toBe(true);
    expect(shouldRevalidate(args(undefined))).toBe(false);
  });
});

describe('the order’s page, for cancelling', () => {
  it('offers to cancel until the order ships', async () => {
    for (const [status, can] of [
      ['PAID', true],
      ['PACKED', true],
      ['SHIPPED', false],
      ['DELIVERED', false],
      ['CANCELLED', false],
      ['EXPIRED', false],
    ] as const) {
      const { data } = await open(`/orders/${ORDER_ID}`, { ...ORDER, status });
      expect([status, (data as { canCancel: boolean }).canCancel]).toEqual([
        status,
        can,
      ]);
    }
  });

  it('offers it while the order waits for payment, but not once the time to pay is over', async () => {
    const waiting = { ...ORDER, status: 'PENDING_PAYMENT', payment: null };
    const { data } = await open(`/orders/${ORDER_ID}`, waiting);
    expect(data).toMatchObject({ payProblem: 'over', canCancel: false });
  });

  it('says it is cancelled only for a cancelled order, back from cancelling', async () => {
    const cancelled = { ...ORDER, status: 'CANCELLED' };
    expect(
      (await open(`/orders/${ORDER_ID}?done=cancelled`, cancelled)).data,
    ).toMatchObject({ done: true });
    expect(
      (await open(`/orders/${ORDER_ID}?done=cancelled`, ORDER)).data,
    ).toMatchObject({ done: false });
    expect(
      (await open(`/orders/${ORDER_ID}?done=paid`, cancelled)).data,
    ).toMatchObject({ done: false });
  });
});
