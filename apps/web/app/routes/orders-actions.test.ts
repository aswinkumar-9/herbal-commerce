// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timeInIndia } from '../orders.server.ts';
import type { CustomerSession } from '../session.server.ts';
import { answer, contextWith, outcome } from '../test/route-calls.ts';
import { loader } from './orders.tsx';

// The customer's orders (part 14D), against a stand-in for the API.
const SITE = 'http://localhost:3001';
const SIGNED_IN: CustomerSession = {
  accessToken: 'access.jwt.one',
  refreshToken: 'refresh-token-one-0123456789',
  accessEndsAt: Date.now() + 10 * 60_000,
  endsAt: Date.now() + 20 * 24 * 60 * 60_000,
};
const FIRST = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const SECOND = '9b2d4c6e-8f1a-4b3c-9d5e-7f6a8b9c0d1e';
const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();
const listed = (id: string, more: Record<string, unknown> = {}) => ({
  id,
  reference: '7KQ2M9XDPA',
  status: 'PAID',
  totalRupees: 1347,
  holdExpiresAt: '2026-11-07T14:57:38.771Z',
  createdAt: '2026-11-07T20:42:38.771Z',
  firstProductName: 'Ashwagandha Capsules',
  moreProducts: 2,
  ...more,
});

const fetchMock = vi.fn<typeof fetch>();
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
function api(body: () => Response) {
  fetchMock.mockImplementation(async (url) => {
    if (new URL(String(url)).pathname !== '/v1/me/orders') {
      throw new Error(`not expected: ${String(url)}`);
    }
    return body();
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

function open(url = '/orders', session: CustomerSession | null = SIGNED_IN) {
  const { context } = contextWith(session);
  return outcome(() =>
    loader({
      request: new Request(`${SITE}${url}`),
      context,
      params: {},
    } as never),
  );
}

describe('the list of orders', () => {
  it('asks the API for 20 of the customer’s orders, and shows each as the list does', async () => {
    api(() =>
      answer(200, {
        orders: [listed(FIRST), listed(SECOND, { moreProducts: 0 })],
        nextBefore: SECOND,
      }),
    );
    const { status, data } = await open();
    expect(status).toBe(200);
    expect(data).toMatchObject({
      orders: [
        {
          id: FIRST,
          reference: '7KQ2M9XDPA',
          what: 'Ashwagandha Capsules and 2 more',
          placedAt: '2026-11-07T20:42:38.771Z',
          // 2:12 am on 8 November in India.
          placedOn: '8 Nov 2026',
          standing: 'PAID',
          payBy: null,
          totalRupees: 1347,
        },
        { id: SECOND, what: 'Ashwagandha Capsules' },
      ],
      nextBefore: SECOND,
      before: null,
    });
    expect(urls()).toEqual(['http://127.0.0.1:3000/v1/me/orders?limit=20']);
  });

  it('says until when an order waiting for payment holds its packs, and when that time is over, says so', async () => {
    const until = inMinutes(10);
    api(() =>
      answer(200, {
        orders: [
          listed(FIRST, { status: 'PENDING_PAYMENT', holdExpiresAt: until }),
          listed(SECOND, {
            status: 'PENDING_PAYMENT',
            holdExpiresAt: inMinutes(-1),
          }),
        ],
        nextBefore: null,
      }),
    );
    const { data } = await open();
    expect(data).toMatchObject({
      orders: [
        { standing: 'PENDING_PAYMENT', payBy: timeInIndia(until) },
        { standing: 'HOLD_OVER', payBy: null },
      ],
    });
  });

  it('names an order with no product by its reference', async () => {
    api(() =>
      answer(200, {
        orders: [listed(FIRST, { firstProductName: null, moreProducts: 0 })],
        nextBefore: null,
      }),
    );
    const { data } = await open();
    expect(data).toMatchObject({ orders: [{ what: 'Order 7KQ2M9XDPA' }] });
  });

  it('continues after an order’s ID, and starts again for anything else', async () => {
    api(() => answer(200, { orders: [], nextBefore: null }));
    const later = await open(`/orders?before=${SECOND}`);
    expect(later.data).toMatchObject({ before: SECOND });
    for (const asked of ['x', '1%20OR%201', `${SECOND}x`, '']) {
      const { data } = await open(`/orders?before=${asked}`);
      expect(data).toMatchObject({ before: null });
    }
    expect(urls()).toEqual([
      `http://127.0.0.1:3000/v1/me/orders?limit=20&before=${SECOND}`,
      ...Array.from(
        { length: 4 },
        () => 'http://127.0.0.1:3000/v1/me/orders?limit=20',
      ),
    ]);
  });

  it('sends a visitor to sign in, and back here after, without asking the API', async () => {
    expect(await open('/orders', null)).toMatchObject({
      status: 302,
      location: '/sign-in?next=%2Forders',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a short break when the API can’t answer, or answers something else', async () => {
    api(() => answer(503, { message: 'Server busy' }));
    expect(await open()).toMatchObject({ status: 503 });
    api(() => answer(200, { orders: [{ id: 'not-an-id' }], nextBefore: null }));
    expect(await open()).toMatchObject({ status: 503 });
  });
});
