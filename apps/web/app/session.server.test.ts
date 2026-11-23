// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from './config.server.ts';
import { CLIENT_IP_HEADER } from './security-headers.ts';
import {
  SESSION_DAYS,
  SessionHandle,
  cookieHeader,
  cookieName,
  forgetRenewals,
  readCookie,
  requireCustomer,
  seal,
  sessionContext,
  sessionMiddleware,
  sessionOf,
  unseal,
} from './session.server.ts';
import type { CustomerSession } from './session.server.ts';

const NAME = 'herbal_session';
const SECRET = 'a-secret-only-these-tests-know-0123456789';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 21, 10, 0, 0);

const session = (changes: Partial<CustomerSession> = {}): CustomerSession => ({
  accessToken: 'access.jwt.one',
  refreshToken: 'refresh-token-one-0123456789',
  accessEndsAt: NOW + 10 * 60_000,
  endsAt: NOW + 20 * DAY,
  ...changes,
});

describe('the sealed cookie', () => {
  it('opens to the same session, and its value shows none of it', () => {
    const value = seal(session(), SECRET, NAME);
    expect(value).toMatch(/^v1\.[\w-]{16}\.[\w-]+$/);
    expect(value).not.toContain('access.jwt.one');
    expect(value).not.toContain('refresh-token-one');
    expect(unseal(value, SECRET, NAME)).toEqual(session());
    // Sealed afresh each time.
    expect(seal(session(), SECRET, NAME)).not.toBe(value);
  });

  it('opens to nothing when changed, sealed under another key or for another cookie', () => {
    const value = seal(session(), SECRET, NAME);
    const [version, iv, sealed] = value.split('.') as [string, string, string];
    const flipped = `${sealed.slice(0, 10)}${sealed[10] === 'A' ? 'B' : 'A'}${sealed.slice(11)}`;
    expect(unseal(`${version}.${iv}.${flipped}`, SECRET, NAME)).toBeNull();
    expect(unseal(value, `${SECRET}-other`, NAME)).toBeNull();
    expect(unseal(value, SECRET, '__Host-herbal_session')).toBeNull();
    for (const odd of [
      '',
      'v1',
      `v2.${iv}.${sealed}`,
      `v1.${iv}`,
      `v1.${iv}.${sealed}.x`,
      'v1.AAAA.AAAA',
      `v1.${iv}.${'A'.repeat(5000)}`,
      'v1.!!.!!',
    ]) {
      expect([odd.slice(0, 20), unseal(odd, SECRET, NAME)]).toEqual([
        odd.slice(0, 20),
        null,
      ]);
    }
  });

  it('is named for the address: __Host- and Secure on https', () => {
    expect(cookieName('https://shop.example.com')).toBe(
      '__Host-herbal_session',
    );
    expect(cookieName('http://localhost:3001')).toBe('herbal_session');
  });

  it('is Secure under its __Host- name, as browsers then require', () => {
    expect(cookieHeader('__Host-herbal_session', 'v1.a.b', 60)).toBe(
      '__Host-herbal_session=v1.a.b; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure',
    );
    expect(cookieHeader('herbal_session', 'v1.a.b', 60)).toBe(
      'herbal_session=v1.a.b; Path=/; Max-Age=60; HttpOnly; SameSite=Lax',
    );
  });

  it('is read by its exact name only', () => {
    expect(readCookie('a=1; herbal_session=v1.x.y; b=2', NAME)).toBe('v1.x.y');
    expect(readCookie('xherbal_session=v1.x.y', NAME)).toBeNull();
    expect(readCookie('herbal_session2=v1.x.y', NAME)).toBeNull();
    expect(readCookie(null, NAME)).toBeNull();
  });
});

// The middleware, around a page that does what the test asks.
const fetchMock = vi.fn<typeof fetch>();
const tokens = (n: number) => ({
  accessToken: `access.jwt.${n}`,
  tokenType: 'Bearer',
  expiresIn: 900,
  refreshToken: `refresh-token-${n}-0123456789`,
});
const answer = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function cookieOf(value: CustomerSession): string {
  const { sessionSecret } = getConfig();
  return `${NAME}=${seal(value, sessionSecret, NAME)}`;
}

async function visit(
  cookie: string | null,
  page: (handle: SessionHandle) => void = () => undefined,
) {
  const context = new RouterContextProvider();
  const headers = new Headers({ [CLIENT_IP_HEADER]: '203.0.113.7' });
  if (cookie) {
    headers.set('cookie', cookie);
  }
  const response = await sessionMiddleware(
    {
      request: new Request('http://localhost:3001/account', { headers }),
      context,
      params: {},
    } as never,
    async () => {
      page(sessionOf(context));
      return new Response('page', {
        headers: { 'Cache-Control': 'private, no-cache' },
      });
    },
  );
  const setCookie = (response as Response).headers.get('set-cookie');
  return {
    response: response as Response,
    handle: sessionOf(context),
    setCookie,
    // The session the new cookie holds.
    sealed: () => {
      const value = /herbal_session=([^;]*)/.exec(setCookie ?? '')?.[1] ?? '';
      return unseal(value, getConfig().sessionSecret, NAME);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  forgetRenewals();
});
afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('the session on each request', () => {
  it('is none without a cookie, and writes none', async () => {
    const seen = await visit(null);
    expect(seen.handle.current).toBeNull();
    expect(seen.setCookie).toBeNull();
    expect(seen.response.headers.get('cache-control')).toBe(
      'private, no-cache',
    );
  });

  it('opens a good cookie, writes nothing back, and keeps the page from every cache', async () => {
    const seen = await visit(cookieOf(session()));
    expect(seen.handle.current).toEqual(session());
    expect(seen.setCookie).toBeNull();
    expect(seen.response.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears a cookie that does not open, and one whose 30 days are over', async () => {
    for (const cookie of [
      `${NAME}=v1.bad.cookie`,
      cookieOf(session({ endsAt: NOW - 1 })),
    ]) {
      const seen = await visit(cookie);
      expect(seen.handle.current).toBeNull();
      expect(seen.setCookie).toBe(
        `${NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renews the access token a minute before it ends, keeping the session’s end', async () => {
    fetchMock.mockResolvedValue(answer(200, tokens(2)));
    const old = session({ accessEndsAt: NOW + 30_000 });

    const seen = await visit(cookieOf(old));

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:3000/v1/auth/refresh');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      refreshToken: old.refreshToken,
    });
    expect(new Headers(init.headers).get('x-forwarded-for')).toBe(
      '203.0.113.7',
    );
    const renewed = {
      accessToken: 'access.jwt.2',
      refreshToken: 'refresh-token-2-0123456789',
      accessEndsAt: NOW + 900_000,
      endsAt: old.endsAt,
    };
    expect(seen.handle.current).toEqual(renewed);
    expect(seen.sealed()).toEqual(renewed);
    expect(seen.setCookie).toMatch(
      new RegExp(
        `; Path=/; Max-Age=${20 * 24 * 60 * 60}; HttpOnly; SameSite=Lax$`,
      ),
    );
  });

  it('renews once for requests that come together with the same cookie, and for one soon after', async () => {
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const cookie = cookieOf(session({ accessEndsAt: NOW + 30_000 }));

    const both = Promise.all([visit(cookie), visit(cookie)]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(answer(200, tokens(2)));
    const [first, second] = await both;
    vi.setSystemTime(NOW + 30_000);
    const later = await visit(cookie);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const seen of [first, second, later]) {
      expect(seen.handle.current?.refreshToken).toBe(
        'refresh-token-2-0123456789',
      );
    }
  });

  it('signs out when the API refuses the renewal', async () => {
    fetchMock.mockResolvedValue(
      answer(401, { message: 'Invalid refresh token' }),
    );

    const seen = await visit(cookieOf(session({ accessEndsAt: NOW - 1 })));

    expect(seen.handle.current).toBeNull();
    expect(seen.setCookie).toContain('Max-Age=0');
  });

  it('keeps the session when the API can’t be reached, and tries again next time', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const old = session({ accessEndsAt: NOW - 1 });

    const first = await visit(cookieOf(old));
    await Promise.resolve();
    const second = await visit(cookieOf(old));

    expect(first.handle.current).toEqual(old);
    expect(first.setCookie).toBeNull();
    expect(second.handle.current).toEqual(old);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('writes the cookie when a page signs in, for 30 days, out of every script’s reach', async () => {
    const seen = await visit(null, (handle) =>
      handle.signIn(tokens(5) as never, Date.now()),
    );
    expect(seen.setCookie).toMatch(
      new RegExp(
        `^${NAME}=v1\\.[\\w-]+\\.[\\w-]+; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; HttpOnly; SameSite=Lax$`,
      ),
    );
    expect(seen.setCookie).not.toContain('access.jwt.5');
    expect(seen.sealed()).toEqual({
      accessToken: 'access.jwt.5',
      refreshToken: 'refresh-token-5-0123456789',
      accessEndsAt: NOW + 900_000,
      endsAt: NOW + SESSION_DAYS * DAY,
    });
    expect(seen.response.headers.get('cache-control')).toBe(
      'private, no-store',
    );
  });

  it('clears the cookie when a page signs out', async () => {
    const seen = await visit(cookieOf(session()), (handle) => handle.signOut());
    expect(seen.handle.current).toBeNull();
    expect(seen.setCookie).toContain('Max-Age=0');
    expect(seen.response.headers.get('cache-control')).toBe(
      'private, no-cache',
    );
  });
});

describe('a page for a signed-in customer only', () => {
  const contextWith = (value: CustomerSession | null) => {
    const context = new RouterContextProvider();
    context.set(sessionContext, new SessionHandle(value));
    return context;
  };

  it('sends anyone else to sign in, then back to the page', () => {
    for (const [asked, next] of [
      ['http://localhost:3001/account?tab=x', '/account?tab=x'],
      ['http://localhost:3001/account.data', '/account'],
    ] as const) {
      let thrown: unknown;
      try {
        requireCustomer(new Request(asked), contextWith(null));
      } catch (error) {
        thrown = error;
      }
      expect((thrown as Response).status).toBe(302);
      expect((thrown as Response).headers.get('location')).toBe(
        `/sign-in?next=${encodeURIComponent(next)}`,
      );
    }
  });

  it('gives a signed-in customer’s session', () => {
    expect(
      requireCustomer(
        new Request('http://localhost:3001/account'),
        contextWith(session()),
      ),
    ).toEqual(session());
  });

  it('fails loudly if the middleware never ran', () => {
    expect(() => sessionOf(new RouterContextProvider())).toThrow(
      'The session middleware did not run',
    );
  });
});
