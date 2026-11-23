// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_CART_EMPTY,
  API_NOT_ENOUGH,
  API_NOT_READY,
  API_TOO_MANY_OPEN,
  API_TOTAL_CHANGED,
  UUID,
} from '../orders.server.ts';
import type { CustomerSession } from '../session.server.ts';
import { answer, contextWith, outcome, post } from '../test/route-calls.ts';
import {
  action as newAddressAction,
  loader as newAddressLoader,
} from './address-new.tsx';
import {
  action as checkoutAction,
  loader as checkoutLoader,
  shouldRevalidate,
} from './checkout.tsx';
import { loader as orderLoader } from './order.tsx';

// Checkout and an order's page (part 14C, ADR 0042), against a stand-in
// for the API.
const SITE = 'http://localhost:3001';
const API = 'http://127.0.0.1:3000/v1';
const SIGNED_IN: CustomerSession = {
  accessToken: 'access.jwt.one',
  refreshToken: 'refresh-token-one-0123456789',
  accessEndsAt: Date.now() + 10 * 60_000,
  endsAt: Date.now() + 20 * 24 * 60 * 60_000,
};
const HOME_ID = '0b6f3c1e-8f3a-4c55-9a51-3c2b1d7e9f10';
const OFFICE_ID = '7d0c2b4a-1e2f-4a3b-8c9d-0e1f2a3b4c5d';
const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const KEY = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const address = (id: string, line1: string, isDefault: boolean) => ({
  id,
  fullName: 'Asha Verma',
  phone: '9845012345',
  line1,
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  isDefault,
});
const ADDRESSES = {
  addresses: [
    address(HOME_ID, '12 MG Road', true),
    address(OFFICE_ID, '4 Residency Road', false),
  ],
};
const LINE = {
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
};
const CHECKOUT = {
  items: [LINE],
  itemsTotalRupees: 449,
  itemsGstRupees: 21,
  deliveryChargeRupees: 49,
  totalRupees: 498,
};
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
  items: [LINE],
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

const fetchMock = vi.fn<typeof fetch>();
const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method ?? 'GET',
    body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    key: new Headers(init?.headers).get('idempotency-key'),
    authorization: new Headers(init?.headers).get('authorization'),
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
});

type Run = (args: never) => unknown;
function call(
  run: Run,
  url: string,
  {
    form,
    params = {},
    session = SIGNED_IN,
  }: {
    form?: Record<string, string>;
    params?: Record<string, string>;
    session?: CustomerSession | null;
  } = {},
) {
  const { context } = contextWith(session);
  const request = form
    ? post(`${SITE}${url}`, form)
    : new Request(`${SITE}${url}`);
  return outcome(() => run({ request, context, params } as never));
}
const PLACE = {
  intent: 'place',
  addressId: HOME_ID,
  total: '498',
  key: KEY,
};

describe('checkout and an order’s page', () => {
  it('are only for a signed-in customer: anyone else signs in first, and comes back', async () => {
    expect(
      await call(checkoutLoader as Run, '/checkout', { session: null }),
    ).toMatchObject({ status: 302, location: '/sign-in?next=%2Fcheckout' });
    expect(
      await call(orderLoader as Run, `/orders/${ORDER_ID}`, {
        params: { id: ORDER_ID },
        session: null,
      }),
    ).toMatchObject({
      status: 302,
      location: `/sign-in?next=${encodeURIComponent(`/orders/${ORDER_ID}`)}`,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the checkout page', () => {
  const open = (url = '/checkout', checkout = () => answer(200, CHECKOUT)) => {
    api({
      'GET /v1/me/checkout': checkout,
      'GET /v1/me/addresses': () => answer(200, ADDRESSES),
    });
    return call(checkoutLoader as Run, url);
  };

  it('shows the cart as the API prices it as an order, the default address chosen, and a new key', async () => {
    const { data } = await open();
    expect(data).toMatchObject({
      checkout: CHECKOUT,
      problem: null,
      chosen: HOME_ID,
    });
    const { key } = data as { key: string };
    expect(key).toMatch(UUID);
    const again = (await open()).data as { key: string };
    expect(again.key).not.toBe(key);
  });

  it('chooses the address just added, if it is the customer’s', async () => {
    expect((await open(`/checkout?address=${OFFICE_ID}`)).data).toMatchObject({
      chosen: OFFICE_ID,
    });
    expect(
      (await open('/checkout?address=00000000-0000-4000-8000-000000000000'))
        .data,
    ).toMatchObject({ chosen: HOME_ID });
  });

  it('says why the cart can’t be ordered, in its own words', async () => {
    for (const [message, problem] of [
      [API_CART_EMPTY, 'empty'],
      [
        `${API_NOT_READY}ASH-CAP-60. Change or remove them first.`,
        'unavailable',
      ],
      [API_TOTAL_CHANGED, 'changed'],
      [API_TOO_MANY_OPEN, 'tooMany'],
      [`ASH-CAP-60${API_NOT_ENOUGH}`, 'stock'],
    ] as const) {
      const { data } = await open('/checkout', () => answer(409, { message }));
      expect(data, message).toMatchObject({ checkout: null, problem });
    }
  });

  it('is a short break when the API can’t price it', async () => {
    expect(
      await open('/checkout', () => answer(503, { message: 'Server busy' })),
    ).toMatchObject({ status: 503 });
  });
});

describe('placing the order', () => {
  it('sends the chosen address, the total shown and its key, then goes to the order', async () => {
    api({ 'POST /v1/me/orders': () => answer(201, ORDER) });
    expect(
      await call(checkoutAction as Run, '/checkout', { form: PLACE }),
    ).toMatchObject({ status: 302, location: `/orders/${ORDER_ID}` });
    expect(sent()).toEqual([
      {
        url: `${API}/me/orders`,
        method: 'POST',
        body: { addressId: HOME_ID, totalRupees: 498 },
        key: KEY,
        authorization: 'Bearer access.jwt.one',
      },
    ]);
  });

  it('never sends an address, a total or a key it would refuse', async () => {
    for (const form of [
      { ...PLACE, addressId: '../me' },
      { ...PLACE, total: '0' },
      { ...PLACE, total: '498.5' },
      { ...PLACE, total: '' },
      { ...PLACE, key: 'not-a-key' },
      { ...PLACE, intent: 'other' },
    ]) {
      const result = await call(checkoutAction as Run, '/checkout', { form });
      expect(result.status, JSON.stringify(form)).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says why it was refused; a new total shows when the page asks again', async () => {
    const placing = (status: number, body: object, headers = {}) => {
      api({ 'POST /v1/me/orders': () => answer(status, body, headers) });
      return call(checkoutAction as Run, '/checkout', { form: PLACE });
    };
    expect(await placing(409, { message: API_TOTAL_CHANGED })).toMatchObject({
      status: 409,
      data: { problem: 'changed', key: null },
    });
    expect(
      await placing(409, { message: `ASH-CAP-60${API_NOT_ENOUGH}` }),
    ).toMatchObject({ data: { problem: 'stock' } });
    expect(await placing(404, { message: 'Address not found' })).toMatchObject({
      status: 404,
      data: { problem: 'address' },
    });
    expect(
      await placing(429, { message: 'Too many' }, { 'retry-after': '120' }),
    ).toMatchObject({
      status: 429,
      data: { wait: 'Too many tries. Please wait 2 minutes and try again.' },
    });
  });

  it('when it is not known whether it went, keeps the key, so trying again places it once at most', async () => {
    api({
      'POST /v1/me/orders': () => answer(503, { message: 'Server busy' }),
    });
    expect(
      await call(checkoutAction as Run, '/checkout', { form: PLACE }),
    ).toMatchObject({
      status: 503,
      data: { problem: 'resting', key: KEY },
    });
  });
});

describe('after "Place order"', () => {
  it('the page always asks again, even refused, so it shows today’s total and a new key', () => {
    const asked = (actionStatus: number | undefined) =>
      shouldRevalidate({
        actionStatus,
        defaultShouldRevalidate: false,
      } as never);
    expect(asked(409)).toBe(true);
    expect(asked(503)).toBe(true);
    expect(asked(undefined)).toBe(false);
  });
});

describe('an order’s page', () => {
  it('shows the customer’s order, with when its hold ends in India', async () => {
    api({ [`GET /v1/me/orders/${ORDER_ID}`]: () => answer(200, ORDER) });
    const { data } = await call(orderLoader as Run, `/orders/${ORDER_ID}`, {
      params: { id: ORDER_ID },
    });
    // 14:57 in London is 8:27 pm in India.
    expect(data).toMatchObject({ order: ORDER, holdUntil: '8:27 pm' });
  });

  it('is "not found" for an address no order has, or someone else’s', async () => {
    expect(
      await call(orderLoader as Run, '/orders/7', { params: { id: '7' } }),
    ).toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
    api({
      [`GET /v1/me/orders/${ORDER_ID}`]: () =>
        answer(404, { message: 'Order not found' }),
    });
    expect(
      await call(orderLoader as Run, `/orders/${ORDER_ID}`, {
        params: { id: ORDER_ID },
      }),
    ).toMatchObject({ status: 404 });
  });
});

describe('adding an address from checkout', () => {
  const TYPED = {
    intent: 'save',
    fullName: 'Asha Verma',
    phone: '98450 12345',
    line1: '4 Residency Road',
    line2: '',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560025',
  };

  it('goes back to checkout with the new address chosen', async () => {
    api({
      'POST /v1/me/addresses': () =>
        answer(201, address(OFFICE_ID, '4 Residency Road', false)),
    });
    expect(
      await call(
        newAddressAction as Run,
        '/account/addresses/new?then=checkout',
        { form: TYPED },
      ),
    ).toMatchObject({
      status: 302,
      location: `/checkout?address=${OFFICE_ID}`,
    });
  });

  it('knows it came from checkout, for its way back', async () => {
    api({ 'GET /v1/me/addresses': () => answer(200, ADDRESSES) });
    expect(
      (
        await call(
          newAddressLoader as Run,
          '/account/addresses/new?then=checkout',
        )
      ).data,
    ).toMatchObject({ fromCheckout: true });
    expect(
      (
        await call(
          newAddressLoader as Run,
          '/account/addresses/new?then=elsewhere',
        )
      ).data,
    ).toMatchObject({ fromCheckout: false });
  });
});

describe('the order’s rules, as the API’s', () => {
  it('the same words for why a cart can’t be ordered', () => {
    const rules = readFileSync(
      join(import.meta.dirname, '../../../api/src/orders/order-rules.ts'),
      'utf8',
    );
    expect(rules).toContain(`export const CART_EMPTY = '${API_CART_EMPTY}';`);
    expect(rules).toContain(`'${API_TOTAL_CHANGED}'`);
    expect(rules).toContain(
      'export const TOO_MANY_OPEN = `You have ${MAX_OPEN_ORDERS} orders waiting for payment. Pay for one or cancel it first.`;',
    );
    expect(rules).toContain('export const MAX_OPEN_ORDERS = 3;');
    expect(API_TOO_MANY_OPEN).toBe(
      'You have 3 orders waiting for payment. Pay for one or cancel it first.',
    );
    expect(rules).toContain(
      "`These packs can't be ordered now: ${skus.join(', ')}. Change or remove them first.`",
    );
    expect(API_NOT_READY).toBe("These packs can't be ordered now: ");
    expect(rules).toContain(`\`\${sku}${API_NOT_ENOUGH}\``);
  });
});
