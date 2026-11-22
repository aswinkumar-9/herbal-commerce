// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '../form-checks.server.ts';
import type { CustomerSession } from '../session.server.ts';
import { safeNext } from '../sign-in-next.ts';
import { answer, contextWith, outcome } from '../test/route-calls.ts';
import { loader as accountLoader } from './account.tsx';
import { action as signInAction, loader as signInLoader } from './sign-in.tsx';
import {
  action as signOutAction,
  loader as signOutLoader,
} from './sign-out.tsx';

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

const fetchMock = vi.fn<typeof fetch>();
const sent = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [URL, RequestInit];
  return {
    url: String(url),
    method: init.method,
    body: init.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    authorization: new Headers(init.headers).get('authorization'),
  };
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const signInWith = (
  fields: Record<string, string>,
  session: CustomerSession | null = null,
) => {
  const { context, handle } = contextWith(session);
  const request = new Request('http://localhost:3001/sign-in', {
    method: 'POST',
    body: new URLSearchParams(fields),
  });
  return {
    handle,
    run: () =>
      outcome(() => signInAction({ request, context, params: {} } as never)),
  };
};

describe('where signing in leads', () => {
  it('is a page of this website, else the account', () => {
    expect(safeNext('/account')).toBe('/account');
    expect(safeNext('/shop?q=tulsi')).toBe('/shop?q=tulsi');
    expect(safeNext('/products/a/../b')).toBe('/products/b');
    for (const elsewhere of [
      null,
      undefined,
      '',
      'account',
      '//evil.example',
      '/\\evil.example',
      'https://evil.example/',
      '/\u0000',
      '/a\nb',
      '/sign-in',
      '/sign-out',
      '/sign-up',
      '/verify-email?token=someone-elses-token-0123',
      '/forgot-password',
      '/reset-password?token=someone-elses-token-0123',
      `/${'a'.repeat(600)}`,
      42,
    ]) {
      expect([String(elsewhere).slice(0, 20), safeNext(elsewhere)]).toEqual([
        String(elsewhere).slice(0, 20),
        '/account',
      ]);
    }
  });
});

describe('the sign-in page', () => {
  it('sends a signed-in customer on to where they were going', async () => {
    const { context } = contextWith(SIGNED_IN);
    const result = await outcome(() =>
      signInLoader({
        request: new Request('http://localhost:3001/sign-in?next=%2Fshop'),
        context,
        params: {},
      } as never),
    );
    expect(result).toMatchObject({ status: 302, location: '/shop' });
  });

  it('keeps only a safe page to come back to', async () => {
    const { context } = contextWith(null);
    const page = (await signInLoader({
      request: new Request(
        'http://localhost:3001/sign-in?next=%2F%2Fevil.example',
      ),
      context,
      params: {},
    } as never)) as { next: string | null };
    expect(page.next).toBe('/account');
  });

  it('signs in with the API, keeps the session, and goes on', async () => {
    fetchMock.mockResolvedValue(answer(200, TOKENS));
    const { handle, run } = signInWith({
      email: ' Asha@Example.com ',
      password: 'a long password',
      next: '/shop?q=neem',
    });

    const result = await run();

    expect(result).toMatchObject({ status: 302, location: '/shop?q=neem' });
    expect(sent()).toMatchObject({
      url: 'http://127.0.0.1:3000/v1/auth/login',
      method: 'POST',
      body: { email: 'Asha@Example.com', password: 'a long password' },
    });
    expect(handle.current).toMatchObject({
      accessToken: 'access.jwt.two',
      refreshToken: 'refresh-token-two-0123456789',
    });
    expect(handle.changed).toBe(true);
  });

  it('goes to the account when the page to come back to is not safe', async () => {
    fetchMock.mockResolvedValue(answer(200, TOKENS));
    const result = await signInWith({
      email: 'asha@example.com',
      password: 'a long password',
      next: 'https://evil.example/',
    }).run();
    expect(result.location).toBe('/account');
  });

  it('says what to fix before asking the API, and never sends the password back', async () => {
    for (const [fields, problems] of [
      [
        {},
        {
          email: 'Enter your email address.',
          password: 'Enter your password.',
        },
      ],
      [
        { email: 'not an email', password: 'x' },
        { email: 'Enter an email address like name@example.com.' },
      ],
      [
        { email: 'asha@example.com', password: 'x'.repeat(129) },
        { password: 'A password has at most 128 characters.' },
      ],
    ] as const) {
      const result = await signInWith(fields).run();
      expect(result.status).toBe(400);
      expect((result.data as { problems: unknown }).problems).toEqual(problems);
      expect(JSON.stringify(result.data)).not.toContain('x'.repeat(129));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives one answer for a wrong email or password, with a hint for a new account', async () => {
    fetchMock.mockResolvedValue(
      answer(401, { message: 'Invalid email or password' }),
    );
    const { handle, run } = signInWith({
      email: 'asha@example.com',
      password: 'a wrong password',
    });

    const result = await run();

    expect(result.status).toBe(401);
    expect(result.data).toEqual({
      email: 'asha@example.com',
      problems: {
        form: 'The email address or the password is not right. Please check them and try again.',
        hint: 'Signed up recently? Confirm your email address first, with the link we sent you.',
      },
    });
    expect(handle.current).toBeNull();
    expect(JSON.stringify(result.data)).not.toContain('a wrong password');
  });

  it('says a closed account is closed, how long to wait after too many tries, and when the shop is resting', async () => {
    const tries = [
      [
        answer(403, { message: 'x', code: 'ACCOUNT_DISABLED' }),
        403,
        'This account is closed. To ask about it, see Contact us.',
      ],
      [
        answer(429, { message: 'x' }, { 'retry-after': '300' }),
        429,
        'Too many tries. Please wait 5 minutes and try again.',
      ],
      [
        answer(429, { message: 'x' }, { 'retry-after': '30' }),
        429,
        'Too many tries. Please wait 30 seconds and try again.',
      ],
      [
        answer(503, { message: 'x' }),
        503,
        'We could not sign you in just now. Please try again in a minute.',
      ],
      [
        answer(403, { message: 'x', code: 'SOMETHING_ELSE' }),
        503,
        'We could not sign you in just now. Please try again in a minute.',
      ],
    ] as const;
    for (const [response, status, form] of tries) {
      fetchMock.mockResolvedValueOnce(response);
      const result = await signInWith({
        email: 'asha@example.com',
        password: 'a long password',
      }).run();
      expect([status, form]).toEqual([
        result.status,
        (result.data as { problems: { form: string } }).problems.form,
      ]);
    }
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const unreachable = await signInWith({
      email: 'asha@example.com',
      password: 'a long password',
    }).run();
    expect(unreachable.status).toBe(503);
  });

  it('says beside the field what the API refused', async () => {
    fetchMock.mockResolvedValue(
      answer(400, {
        message: 'Validation failed',
        errors: [{ field: 'email', message: 'Invalid email address' }],
      }),
    );
    const result = await signInWith({
      email: 'asha@example',
      password: 'a long password',
    }).run();
    expect(result.status).toBe(400);
    expect((result.data as { problems: unknown }).problems).toEqual({
      email: 'Enter an email address like name@example.com.',
    });
  });
});

describe('how long to wait', () => {
  it('is said in seconds up to two minutes, then in whole minutes', () => {
    expect(waitFor(0)).toBe('1 second');
    expect(waitFor(1)).toBe('1 second');
    expect(waitFor(90)).toBe('90 seconds');
    expect(waitFor(119)).toBe('119 seconds');
    expect(waitFor(120)).toBe('2 minutes');
    expect(waitFor(121)).toBe('3 minutes');
    expect(waitFor(3600)).toBe('60 minutes');
  });
});

describe('signing out', () => {
  const signOut = (session: CustomerSession | null) => {
    const { context, handle } = contextWith(session);
    return {
      handle,
      run: () =>
        outcome(() =>
          signOutAction({
            request: new Request('http://localhost:3001/sign-out', {
              method: 'POST',
            }),
            context,
            params: {},
          } as never),
        ),
    };
  };

  it('ends the session at the API, clears it here, and goes home', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { handle, run } = signOut(SIGNED_IN);

    const result = await run();

    expect(result).toMatchObject({ status: 302, location: '/' });
    expect(sent()).toMatchObject({
      url: 'http://127.0.0.1:3000/v1/auth/logout',
      method: 'POST',
      body: { refreshToken: SIGNED_IN.refreshToken },
    });
    expect(handle.current).toBeNull();
    expect(handle.changed).toBe(true);
  });

  it('signs out here even when the API can’t be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { handle, run } = signOut(SIGNED_IN);
    expect((await run()).location).toBe('/');
    expect(handle.current).toBeNull();
  });

  it('asks nothing of the API when no one is signed in', async () => {
    const { run } = signOut(null);
    expect((await run()).location).toBe('/');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never happens by opening an address', async () => {
    const result = await outcome(() => signOutLoader());
    expect(result).toMatchObject({ status: 302, location: '/' });
  });
});

describe('the account page', () => {
  const openAccount = (session: CustomerSession | null) => {
    const { context, handle } = contextWith(session);
    return {
      handle,
      run: () =>
        outcome(() =>
          accountLoader({
            request: new Request('http://localhost:3001/account'),
            context,
            params: {},
          } as never),
        ),
    };
  };

  it('sends anyone not signed in to sign in, and back here after', async () => {
    const result = await openAccount(null).run();
    expect(result).toMatchObject({
      status: 302,
      location: '/sign-in?next=%2Faccount',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the API who is signed in and for their addresses, with the session’s token', async () => {
    const address = {
      id: '0b6f3c1e-8f3a-4c55-9a51-3c2b1d7e9f10',
      fullName: 'Asha Verma',
      phone: '9845012345',
      line1: '12 MG Road',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      isDefault: true,
    };
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith('/v1/me/addresses')
        ? answer(200, [
            {
              ...address,
              createdAt: '2026-11-02T09:00:00.000Z',
              updatedAt: '2026-11-02T09:00:00.000Z',
            },
          ])
        : answer(200, {
            id: 'u1',
            email: 'asha@example.com',
            fullName: 'Asha Verma',
            role: 'CUSTOMER',
            emailVerifiedAt: '2026-11-01T10:00:00.000Z',
            createdAt: '2026-11-01T09:00:00.000Z',
          }),
    );
    const result = await openAccount(SIGNED_IN).run();

    expect(
      [sent(0), sent(1)].map(({ url, method, authorization }) => ({
        url,
        method,
        authorization,
      })),
    ).toEqual([
      {
        url: 'http://127.0.0.1:3000/v1/me',
        method: 'GET',
        authorization: 'Bearer access.jwt.one',
      },
      {
        url: 'http://127.0.0.1:3000/v1/me/addresses',
        method: 'GET',
        authorization: 'Bearer access.jwt.one',
      },
    ]);
    // Only what the page shows.
    expect(result.data).toEqual({
      fullName: 'Asha Verma',
      email: 'asha@example.com',
      addresses: [address],
      saved: null,
      origin: 'http://localhost:3001',
    });
  });

  it('signs out here, and to sign in, when the session ended elsewhere', async () => {
    fetchMock.mockResolvedValue(answer(401, { message: 'Unauthorized' }));
    const { handle, run } = openAccount(SIGNED_IN);

    const result = await run();

    expect(result).toMatchObject({
      status: 302,
      location: '/sign-in?next=%2Faccount',
    });
    expect(handle.current).toBeNull();
  });

  it('says the shop is taking a break when the API is resting', async () => {
    fetchMock.mockResolvedValue(answer(503, { message: 'x' }));
    const { handle, run } = openAccount(SIGNED_IN);
    expect((await run()).status).toBe(503);
    expect(handle.current).toEqual(SIGNED_IN);
  });
});
