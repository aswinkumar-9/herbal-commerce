// @vitest-environment node
import { isRouteErrorResponse } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  API_TIMEOUT_MS,
  apiFind,
  apiGet,
  apiSend,
  segment,
} from './api.server.ts';
import { CLIENT_IP_HEADER } from './security-headers.ts';

const schema = z.object({
  categories: z.array(z.object({ name: z.string() })),
});
const GOOD = { categories: [{ name: 'Wellness' }] };

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const answer = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const pageRequest = (headers: Record<string, string> = {}) =>
  new Request('http://localhost:3001/', { headers });

// What a page's loader throws, as React Router sees it.
async function thrown(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { type?: string; data: unknown; init: ResponseInit | null };
  }
  throw new Error('nothing was thrown');
}

describe('asking the API for a page', () => {
  it('asks the API’s /v1 address for JSON, and returns the answer once checked', async () => {
    fetchMock.mockResolvedValue(answer(200, GOOD));
    const query = new URLSearchParams({ limit: '20' });
    await expect(
      apiGet(pageRequest(), 'categories', schema, query),
    ).resolves.toEqual(GOOD);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://127.0.0.1:3000/v1/categories?limit=20');
    expect(new Headers(init?.headers).get('accept')).toBe('application/json');
    expect(init?.redirect).toBe('error');
  });

  it('passes on the customer’s IP, as the website server saw it, for the rate limits', async () => {
    fetchMock.mockResolvedValue(answer(200, GOOD));
    await apiGet(
      pageRequest({ [CLIENT_IP_HEADER]: '203.0.113.7' }),
      'categories',
      schema,
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('x-forwarded-for'),
    ).toBe('203.0.113.7');
  });

  it('passes on no IP when the server knew none', async () => {
    fetchMock.mockResolvedValue(answer(200, GOOD));
    await apiGet(pageRequest(), 'categories', schema);
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('x-forwarded-for'),
    ).toBe(false);
  });

  it('makes a page "not found" when the API doesn’t know it', async () => {
    fetchMock.mockResolvedValue(answer(404, { message: 'Category not found' }));
    const error = await thrown(
      apiGet(pageRequest(), 'categories/nope/products', schema),
    );
    expect(
      isRouteErrorResponse(error) || error.type === 'DataWithResponseInit',
    ).toBe(true);
    expect(error.init?.status).toBe(404);
  });

  it.each([
    ['busy', 503, { 'retry-after': '5' }, '5'],
    ['rate limited', 429, { 'retry-after': '30' }, '30'],
    ['failing', 500, {}, '60'],
    ['refusing the request', 400, {}, '60'],
    ['giving an odd wait', 503, { 'retry-after': 'tomorrow' }, '60'],
  ])(
    'says the shop is taking a break when the API is %s',
    async (_what, status, headers, wait) => {
      fetchMock.mockResolvedValue(answer(status, { message: 'x' }, headers));
      const error = await thrown(apiGet(pageRequest(), 'categories', schema));
      expect(error.init?.status).toBe(503);
      expect(new Headers(error.init?.headers).get('Retry-After')).toBe(wait);
    },
  );

  it('says the shop is taking a break when the API can’t be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const error = await thrown(apiGet(pageRequest(), 'categories', schema));
    expect(error.init?.status).toBe(503);
  });

  it('gives the API a few seconds at most', async () => {
    fetchMock.mockResolvedValue(answer(200, GOOD));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await apiGet(pageRequest(), 'categories', schema);
    expect(timeout).toHaveBeenCalledWith(API_TIMEOUT_MS);
    expect(API_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('never uses an answer that isn’t as expected', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { categories: [{ title: 'Wellness' }] }),
    );
    const error = await thrown(apiGet(pageRequest(), 'categories', schema));
    expect(error.init?.status).toBe(503);
  });

  it('never uses an answer that isn’t JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    const error = await thrown(apiGet(pageRequest(), 'categories', schema));
    expect(error.init?.status).toBe(503);
  });

  it('stops quietly when the customer has left', async () => {
    const leaving = new AbortController();
    const left = new DOMException('The customer left', 'AbortError');
    fetchMock.mockRejectedValue(left);
    leaving.abort();
    const request = new Request('http://localhost:3001/', {
      signal: leaving.signal,
    });
    await expect(apiGet(request, 'categories', schema)).rejects.toBe(left);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('keeps search words out of its log', async () => {
    fetchMock.mockResolvedValue(answer(500, { message: 'x' }));
    await thrown(
      apiGet(
        pageRequest(),
        'products',
        schema,
        new URLSearchParams({ q: 'private words' }),
      ),
    );
    expect(String(vi.mocked(console.error).mock.calls)).not.toContain(
      'private',
    );
  });
});

describe('asking for an answer that may rightly be missing', () => {
  it('gives nothing when the API doesn’t have it, rather than "not found"', async () => {
    fetchMock.mockResolvedValue(answer(404, { message: 'Not published yet' }));
    await expect(
      apiFind(pageRequest(), 'policies/terms', schema),
    ).resolves.toBeNull();
  });

  it('gives the answer once checked, like apiGet', async () => {
    fetchMock.mockResolvedValue(answer(200, GOOD));
    await expect(
      apiFind(pageRequest(), 'policies/terms', schema),
    ).resolves.toEqual(GOOD);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://127.0.0.1:3000/v1/policies/terms',
    );
  });

  it('still says the shop is taking a break when the API is busy or odd', async () => {
    fetchMock.mockResolvedValueOnce(answer(503, { message: 'x' }));
    expect(
      (await thrown(apiFind(pageRequest(), 'policies/terms', schema))).init
        ?.status,
    ).toBe(503);
    fetchMock.mockResolvedValueOnce(answer(200, { something: 'else' }));
    expect(
      (await thrown(apiFind(pageRequest(), 'policies/terms', schema))).init
        ?.status,
    ).toBe(503);
  });
});

describe('sending a form to the API, or asking for a signed-in customer', () => {
  const tokens = z.object({ accessToken: z.string() });

  it('sends the words as JSON, with the token and the customer’s IP, and gives the checked answer', async () => {
    fetchMock.mockResolvedValue(answer(200, { accessToken: 'a', extra: 'x' }));

    const result = await apiSend(
      pageRequest({ [CLIENT_IP_HEADER]: '203.0.113.7' }),
      {
        method: 'POST',
        path: 'auth/login',
        body: { email: 'a@example.com' },
        accessToken: 't1',
      },
      tokens,
    );

    expect(result).toEqual({ ok: true, data: { accessToken: 'a' } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:3000/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"email":"a@example.com"}');
    expect(init.redirect).toBe('error');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer t1');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7');
  });

  it('takes an answer with no content', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      apiSend(
        pageRequest(),
        { method: 'POST', path: 'auth/logout', body: {} },
        z.undefined(),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
  });

  it('gives back a refusal for the page to explain: status, code, message, fields and wait', async () => {
    fetchMock.mockResolvedValue(
      answer(
        400,
        {
          message: 'Validation failed',
          code: 'SOME_CODE',
          errors: [
            { field: 'email', message: 'Invalid email' },
            { field: 'email', message: 'A second one' },
            { field: '__proto__', message: 'Odd' },
          ],
        },
        { 'retry-after': '30' },
      ),
    );

    const result = await apiSend(
      pageRequest(),
      { method: 'POST', path: 'auth/login', body: {} },
      tokens,
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'SOME_CODE',
      message: 'Validation failed',
      fields: { email: 'Invalid email', ['__proto__']: 'Odd' },
      retryAfter: 30,
    });
    expect(Object.getPrototypeOf((result as { fields: object }).fields)).toBe(
      Object.prototype,
    );
  });

  it('says status 0 when the API can’t be reached or answers unexpectedly, and logs no words sent', async () => {
    const logged = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchMock.mockResolvedValueOnce(answer(200, { something: 'else' }));
    fetchMock.mockResolvedValueOnce(answer(500, { message: 'x' }));
    const send = () =>
      apiSend(
        pageRequest(),
        {
          method: 'POST',
          path: 'auth/login',
          body: { password: 'secret-words' },
        },
        tokens,
      );

    expect(await send()).toMatchObject({ ok: false, status: 0 });
    expect(await send()).toMatchObject({ ok: false, status: 0 });
    expect(await send()).toMatchObject({ ok: false, status: 500 });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-words');
  });
});

describe('a part of an address', () => {
  it('can’t reach another path', () => {
    expect(segment('../staff/admins')).toBe('..%2Fstaff%2Fadmins');
    expect(segment('hair-care')).toBe('hair-care');
  });
});
