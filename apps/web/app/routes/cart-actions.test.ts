// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_OUT_OF_STOCK,
  addIntent,
  cartSchema,
  isSku,
} from '../cart.server.ts';
import type { CustomerSession } from '../session.server.ts';
import { answer, contextWith, outcome, post } from '../test/route-calls.ts';
import { action as cartAction, loader as cartLoader } from './cart.tsx';
import {
  action as productAction,
  loader as productLoader,
} from './product.tsx';
import { action as signInAction, loader as signInLoader } from './sign-in.tsx';

// Adding to the cart, and the cart's own page (part 14C, ADR 0042), against
// a stand-in for the API.
const SITE = 'http://localhost:3001';
const API = 'http://127.0.0.1:3000/v1';
const MEDIA = 'http://127.0.0.1:3000/media/products';
const SIGNED_IN: CustomerSession = {
  accessToken: 'access.jwt.one',
  refreshToken: 'refresh-token-one-0123456789',
  accessEndsAt: Date.now() + 10 * 60_000,
  endsAt: Date.now() + 20 * 24 * 60 * 60_000,
};
const TOKENS = {
  accessToken: 'access.jwt.two',
  tokenType: 'Bearer',
  expiresIn: 900,
  refreshToken: 'refresh-token-two-0123456789',
};

const PRODUCT = {
  name: 'Ashwagandha Capsules',
  slug: 'ashwagandha-capsules',
  summary: null,
  description: null,
  ingredients: 'Ashwagandha root extract',
  usage: null,
  type: 'AYURVEDIC_MEDICINE',
  licenceNumber: '25D/123/2015',
  manufacturerName: 'Herbal Works',
  manufacturerAddress: 'Mysuru',
  countryOfOrigin: 'India',
  category: { name: 'Wellness', slug: 'wellness', parent: null },
  variants: [
    {
      sku: 'ASH-CAP-60',
      quantity: 60,
      unit: 'CAPSULES',
      mrpRupees: 500,
      priceRupees: 449,
      inStock: true,
    },
    {
      sku: 'ASH-CAP-120',
      quantity: 120,
      unit: 'CAPSULES',
      mrpRupees: 900,
      priceRupees: 799,
      inStock: false,
    },
  ],
  images: [],
};
const line = (sku: string, packs: number, extra: object = {}) => ({
  product: {
    name: 'Ashwagandha Capsules',
    slug: 'ashwagandha-capsules',
    imageUrl: `${MEDIA}/a-small.webp`,
  },
  sku,
  quantity: sku === 'ASH-CAP-60' ? 60 : 120,
  unit: 'CAPSULES',
  mrpRupees: 500,
  priceRupees: 449,
  packs,
  lineTotalRupees: 449 * packs,
  status: 'AVAILABLE',
  ...extra,
});
const cart = (...items: ReturnType<typeof line>[]) => ({
  items,
  packs: items.reduce((sum, item) => sum + item.packs, 0),
  subtotalRupees: items.reduce((sum, item) => sum + item.lineTotalRupees, 0),
  mrpTotalRupees: items.reduce((sum, item) => sum + 500 * item.packs, 0),
});

const fetchMock = vi.fn<typeof fetch>();
const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method ?? 'GET',
    body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    authorization: new Headers(init?.headers).get('authorization'),
  }));
// The stand-in answers by method and path.
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
  const { context, handle } = contextWith(session);
  const request = form
    ? post(`${SITE}${url}`, form)
    : new Request(`${SITE}${url}`);
  return {
    handle,
    result: outcome(() => run({ request, context, params } as never)),
  };
}
const PARAMS = { slug: 'ashwagandha-capsules' };
const adding = (
  fields: Record<string, string>,
  session: CustomerSession | null = SIGNED_IN,
) =>
  call(productAction as Run, '/products/ashwagandha-capsules', {
    form: { intent: 'add', ...fields },
    params: PARAMS,
    session,
  }).result;

describe('adding to the cart from a product page', () => {
  it('adds to what the cart holds already: the API sets a line’s packs', async () => {
    api({
      'GET /v1/products/ashwagandha-capsules': () => answer(200, PRODUCT),
      'GET /v1/me/cart': () => answer(200, cart(line('ASH-CAP-60', 1))),
      'PUT /v1/me/cart/items/ASH-CAP-60': () =>
        answer(200, cart(line('ASH-CAP-60', 3))),
    });
    const result = await adding({ sku: 'ASH-CAP-60', packs: '2' });
    expect(result).toMatchObject({
      status: 200,
      data: { added: { sku: 'ASH-CAP-60', packs: 2 }, notAdded: null },
    });
    const put = sent().find((one) => one.method === 'PUT');
    expect(put).toEqual({
      url: `${API}/me/cart/items/ASH-CAP-60`,
      method: 'PUT',
      body: { packs: 3 },
      authorization: 'Bearer access.jwt.one',
    });
  });

  it('never goes over 4 packs of one product, all its sizes together, and says how many more fit', async () => {
    api({
      'GET /v1/products/ashwagandha-capsules': () => answer(200, PRODUCT),
      'GET /v1/me/cart': () =>
        answer(
          200,
          cart(
            line('ASH-CAP-60', 1),
            line('ASH-CAP-120', 2, { status: 'OUT_OF_STOCK' }),
          ),
        ),
    });
    const result = await adding({ sku: 'ASH-CAP-60', packs: '2' });
    expect(result).toMatchObject({
      status: 409,
      data: {
        notAdded: 'full',
        room: 1,
        choice: { sku: 'ASH-CAP-60', packs: 2 },
      },
    });
    expect(sent().some((one) => one.method === 'PUT')).toBe(false);
  });

  it('a pack size out of stock, or not this product’s, or a number outside 1 to 4, is never asked for', async () => {
    api({
      'GET /v1/products/ashwagandha-capsules': () => answer(200, PRODUCT),
    });
    expect(await adding({ sku: 'ASH-CAP-120', packs: '1' })).toMatchObject({
      status: 409,
      data: { notAdded: 'stock' },
    });
    for (const fields of [
      { sku: 'TUL-TEA-100', packs: '1' },
      { sku: 'ASH-CAP-60', packs: '5' },
      { sku: 'ASH-CAP-60', packs: '0' },
      { sku: 'ASH-CAP-60', packs: '1.5' },
      { sku: '', packs: '1' },
    ]) {
      expect(await adding(fields), JSON.stringify(fields)).toMatchObject({
        status: 400,
        data: { notAdded: 'choose' },
      });
    }
    expect(
      sent().every((one) => one.url.endsWith('/products/ashwagandha-capsules')),
    ).toBe(true);
  });

  it('says what the API refused: out of stock just now, no longer sold, or resting', async () => {
    const refusing = (status: number, message: string) => {
      api({
        'GET /v1/products/ashwagandha-capsules': () => answer(200, PRODUCT),
        'GET /v1/me/cart': () => answer(200, cart()),
        'PUT /v1/me/cart/items/ASH-CAP-60': () => answer(status, { message }),
      });
      return adding({ sku: 'ASH-CAP-60', packs: '1' });
    };
    expect(await refusing(409, API_OUT_OF_STOCK)).toMatchObject({
      status: 409,
      data: { notAdded: 'stock' },
    });
    expect(await refusing(404, 'Pack size not found')).toMatchObject({
      status: 409,
      data: { notAdded: 'gone' },
    });
    expect(await refusing(503, 'Server busy')).toMatchObject({
      status: 503,
      data: { notAdded: 'resting' },
    });
  });

  it('someone not signed in signs in first, with the choice kept for when they come back', async () => {
    api({
      'GET /v1/products/ashwagandha-capsules': () => answer(200, PRODUCT),
    });
    const result = await adding({ sku: 'ASH-CAP-60', packs: '2' }, null);
    expect(result.status).toBe(302);
    const next = new URL(result.location ?? '', SITE).searchParams.get('next');
    expect(next).toBe('/products/ashwagandha-capsules?add=ASH-CAP-60&packs=2');
    expect(sent().every((one) => one.authorization === null)).toBe(true);
  });
});

describe('signing in to add', () => {
  const NEXT = '/products/ashwagandha-capsules?add=ASH-CAP-60&packs=2';
  const signingIn = () =>
    call(signInAction as Run, '/sign-in', {
      form: {
        email: 'asha@example.com',
        password: 'a long password',
        next: NEXT,
      },
      session: null,
    });

  it('says so on the sign-in page', async () => {
    const { result } = call(
      signInLoader as Run,
      `/sign-in?next=${encodeURIComponent(NEXT)}`,
      { session: null },
    );
    expect((await result).data).toMatchObject({ forCart: true, next: NEXT });
    const plain = call(signInLoader as Run, '/sign-in?next=%2Faccount', {
      session: null,
    });
    expect((await plain.result).data).toMatchObject({ forCart: false });
  });

  it('adds the pack with the new session, then goes back to the product, which says so', async () => {
    api({
      'POST /v1/auth/login': () => answer(200, TOKENS),
      'GET /v1/me/cart': () => answer(200, cart()),
      'PUT /v1/me/cart/items/ASH-CAP-60': () =>
        answer(200, cart(line('ASH-CAP-60', 2))),
    });
    const { handle, result } = signingIn();
    expect(await result).toMatchObject({
      status: 302,
      location: '/products/ashwagandha-capsules?added=ASH-CAP-60&packs=2',
    });
    expect(handle.current?.accessToken).toBe('access.jwt.two');
    expect(sent().find((one) => one.method === 'PUT')).toMatchObject({
      body: { packs: 2 },
      authorization: 'Bearer access.jwt.two',
    });
  });

  it('when it can’t go in, back to the product with the choice and why', async () => {
    api({
      'POST /v1/auth/login': () => answer(200, TOKENS),
      'GET /v1/me/cart': () => answer(200, cart(line('ASH-CAP-60', 3))),
    });
    expect(await signingIn().result).toMatchObject({
      status: 302,
      location: `${NEXT}&why=full&room=1`,
    });
  });

  it('the product page believes "added" only when the cart holds it', async () => {
    const back = (url: string, held: ReturnType<typeof cart>) => {
      api({
        'GET /v1/products/ashwagandha-capsules': () => answer(200, PRODUCT),
        'GET /v1/me/cart': () => answer(200, held),
      });
      return call(productLoader as Run, url, { params: PARAMS }).result;
    };
    expect(
      (
        await back(
          '/products/ashwagandha-capsules?added=ASH-CAP-60&packs=2',
          cart(line('ASH-CAP-60', 2)),
        )
      ).data,
    ).toMatchObject({ returned: { added: { sku: 'ASH-CAP-60', packs: 2 } } });
    expect(
      (
        await back(
          '/products/ashwagandha-capsules?added=ASH-CAP-60&packs=2',
          cart(),
        )
      ).data,
    ).toMatchObject({ returned: null });
    expect(
      (
        await back(
          '/products/ashwagandha-capsules?add=ASH-CAP-60&packs=2&why=full&room=1',
          cart(),
        )
      ).data,
    ).toMatchObject({
      returned: {
        added: null,
        notAdded: 'full',
        room: 1,
        choice: { sku: 'ASH-CAP-60', packs: 2 },
      },
    });
    // A pack size of another product, or a reason of its own, is no one's.
    expect(
      (
        await back(
          '/products/ashwagandha-capsules?add=TUL-TEA-100&packs=2&why=full',
          cart(),
        )
      ).data,
    ).toMatchObject({ returned: null });
    expect(
      (
        await back(
          '/products/ashwagandha-capsules?add=ASH-CAP-60&packs=2&why=constructor',
          cart(),
        )
      ).data,
    ).toMatchObject({ returned: { notAdded: null } });
  });

  it('reads an intent only from a product’s own address, with a real SKU and 1 to 4 packs', () => {
    expect(addIntent(NEXT)).toEqual({
      slug: 'ashwagandha-capsules',
      sku: 'ASH-CAP-60',
      packs: 2,
    });
    for (const next of [
      '/account?add=ASH-CAP-60&packs=2',
      '/products/ashwagandha-capsules/x?add=ASH-CAP-60&packs=2',
      '/products/ashwagandha-capsules?add=ash-cap-60&packs=2',
      '/products/ashwagandha-capsules?add=ASH-CAP-60&packs=9',
      '/products/ashwagandha-capsules?add=ASH-CAP-60',
    ]) {
      expect(addIntent(next), next).toBeNull();
    }
  });
});

describe('the cart page', () => {
  it('is only for a signed-in customer: anyone else signs in first, and comes back', async () => {
    const { result } = call(cartLoader as Run, '/cart', { session: null });
    expect(await result).toMatchObject({
      status: 302,
      location: '/sign-in?next=%2Fcart',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the cart as the API keeps it, a photo only from the media address', async () => {
    api({
      'GET /v1/me/cart': () =>
        answer(
          200,
          cart(
            line('ASH-CAP-60', 1),
            line('ASH-CAP-120', 1, {
              product: {
                name: 'Ashwagandha Capsules',
                slug: 'ashwagandha-capsules',
                imageUrl: 'https://elsewhere.example/a.webp',
              },
            }),
          ),
        ),
    });
    const { data } = await call(cartLoader as Run, '/cart').result;
    const items = (
      data as { cart: { items: { product: { imageUrl: string | null } }[] } }
    ).cart.items;
    expect(items.map((item) => item.product.imageUrl)).toEqual([
      `${MEDIA}/a-small.webp`,
      null,
    ]);
  });

  it('sets a line’s packs, and says what it is now', async () => {
    api({
      'PUT /v1/me/cart/items/ASH-CAP-60': () =>
        answer(200, cart(line('ASH-CAP-60', 2))),
    });
    const { result } = call(cartAction as Run, '/cart', {
      form: { intent: 'packs', sku: 'ASH-CAP-60', packs: '2' },
    });
    expect(await result).toMatchObject({
      status: 200,
      data: {
        sku: 'ASH-CAP-60',
        name: 'Ashwagandha Capsules, 60 capsules',
        done: 'packs',
        packs: 2,
        problem: null,
      },
    });
    expect(sent()[0]).toMatchObject({ method: 'PUT', body: { packs: 2 } });
  });

  it('takes a line out, naming it first', async () => {
    api({
      'GET /v1/me/cart': () => answer(200, cart(line('ASH-CAP-60', 2))),
      'DELETE /v1/me/cart/items/ASH-CAP-60': () =>
        new Response(null, { status: 204 }),
    });
    const { result } = call(cartAction as Run, '/cart', {
      form: { intent: 'remove', sku: 'ASH-CAP-60' },
    });
    expect(await result).toMatchObject({
      status: 200,
      data: { done: 'removed', name: 'Ashwagandha Capsules, 60 capsules' },
    });
  });

  it('says why a change was refused, and never sends a SKU or a number it would refuse', async () => {
    api({
      'PUT /v1/me/cart/items/ASH-CAP-60': () =>
        answer(409, { message: API_OUT_OF_STOCK }),
    });
    expect(
      await call(cartAction as Run, '/cart', {
        form: { intent: 'packs', sku: 'ASH-CAP-60', packs: '3' },
      }).result,
    ).toMatchObject({ status: 409, data: { problem: 'stock' } });
    fetchMock.mockReset();
    for (const form of [
      { intent: 'packs', sku: '../me', packs: '2' } as Record<string, string>,
      { intent: 'packs', sku: 'ASH-CAP-60', packs: '5' },
      { intent: 'remove', sku: 'ash-cap-60' },
    ]) {
      expect(
        (await call(cartAction as Run, '/cart', { form }).result).status,
        JSON.stringify(form),
      ).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the cart’s rules, as the API’s', () => {
  const api = (path: string) =>
    readFileSync(join(import.meta.dirname, '../../../api/src', path), 'utf8');

  it('the same out-of-stock words, which tell that refusal apart', () => {
    expect(api('cart/cart-rules.ts')).toContain(
      `export const OUT_OF_STOCK = '${API_OUT_OF_STOCK}';`,
    );
  });

  it('the same SKUs', () => {
    expect(api('catalog/variants.schemas.ts')).toContain(
      '/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/',
    );
    expect(isSku('ASH-CAP-60')).toBe(true);
    for (const sku of [
      'AS',
      'ash-cap-60',
      'ASH--CAP',
      '-ASH',
      'ASH/CAP',
      'A'.repeat(41),
    ]) {
      expect(isSku(sku), sku).toBe(false);
    }
  });

  it('a cart in the API’s own example shape is read', () => {
    expect(cartSchema.safeParse(cart(line('ASH-CAP-60', 1))).success).toBe(
      true,
    );
  });
});
