// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emailProblem,
  looksLikeEmailedToken,
  nameProblem,
  newPasswordProblem,
  tooMany,
} from '../form-checks.server.ts';
import { keepOutOfCaches } from '../no-store.server.ts';
import type { CustomerSession } from '../session.server.ts';
import { answer, contextWith, outcome, post } from '../test/route-calls.ts';
import {
  action as forgotAction,
  loader as forgotLoader,
} from './forgot-password.tsx';
import {
  action as resetAction,
  loader as resetLoader,
  middleware as resetMiddleware,
} from './reset-password.tsx';
import { action as signUpAction, loader as signUpLoader } from './sign-up.tsx';
import {
  action as verifyAction,
  loader as verifyLoader,
  middleware as verifyMiddleware,
} from './verify-email.tsx';

const SITE = 'http://localhost:3001';
const API = 'http://127.0.0.1:3000/v1';
// As the API makes them: 43 characters of base64url.
const TOKEN = 'Zm9yIGEgdGVzdCBvbmx5IG5vdCBhIHJlYWwgdG9rZW4';
const SIGNED_IN: CustomerSession = {
  accessToken: 'access.jwt.one',
  refreshToken: 'refresh-token-one-0123456789',
  accessEndsAt: Date.now() + 10 * 60_000,
  endsAt: Date.now() + 20 * 24 * 60 * 60_000,
};
const accepted = () => answer(202, { message: 'If this email address…' });

const fetchMock = vi.fn<typeof fetch>();
const sent = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [URL, RequestInit];
  return {
    url: String(url),
    method: init.method,
    body: init.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
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

type Problems = Record<string, string>;
const problemsOf = (data: unknown) => (data as { problems: Problems }).problems;

// Sends a form to an action, signed in or not.
function sendTo(
  action: (args: never) => unknown,
  path: string,
  fields: Record<string, string>,
  session: CustomerSession | null = null,
) {
  const { context, handle } = contextWith(session);
  const request = post(`${SITE}${path}`, fields);
  return {
    handle,
    run: () => outcome(() => action({ request, context, params: {} } as never)),
  };
}

const load = (
  loader: (args: never) => unknown,
  url: string,
  session: CustomerSession | null = null,
) =>
  outcome(() =>
    loader({
      request: new Request(`${SITE}${url}`),
      context: contextWith(session).context,
      params: {},
    } as never),
  );

describe('what the account forms check first', () => {
  it('an email address', () => {
    expect(emailProblem('')).toBe('Enter your email address.');
    expect(emailProblem('asha@example')).toBe(
      'Enter an email address like name@example.com.',
    );
    expect(emailProblem(`${'a'.repeat(250)}@example.com`)).toBe(
      'Enter an email address like name@example.com.',
    );
    expect(emailProblem('asha@example.com')).toBeUndefined();
  });

  it('a new password: 10 to 128 characters', () => {
    expect(newPasswordProblem('')).toBe('Choose a password.');
    expect(newPasswordProblem('x'.repeat(9))).toBe(
      'Choose a password with at least 10 characters.',
    );
    expect(newPasswordProblem('x'.repeat(10))).toBeUndefined();
    expect(newPasswordProblem('x'.repeat(128))).toBeUndefined();
    expect(newPasswordProblem('x'.repeat(129))).toBe(
      'A password has at most 128 characters.',
    );
  });

  it('a name: 1 to 100 characters', () => {
    expect(nameProblem('')).toBe('Enter your name.');
    expect(nameProblem('A')).toBeUndefined();
    expect(nameProblem('a'.repeat(100))).toBeUndefined();
    expect(nameProblem('a'.repeat(101))).toBe(
      'A name has at most 100 characters.',
    );
  });

  it('a token from an emailed link, as the API makes them', () => {
    expect(looksLikeEmailedToken(TOKEN)).toBe(true);
    expect(looksLikeEmailedToken('a'.repeat(20))).toBe(true);
    expect(looksLikeEmailedToken('a'.repeat(200))).toBe(true);
    for (const wrong of [
      'a'.repeat(19),
      'a'.repeat(201),
      `${TOKEN}.x`,
      `${TOKEN} `,
      `${TOKEN}+`,
      `${TOKEN}%`,
      null,
      42,
    ]) {
      expect([wrong, looksLikeEmailedToken(wrong)]).toEqual([wrong, false]);
    }
  });

  it('how long to wait, a minute when the API gives no figure', () => {
    expect(tooMany(300)).toBe(
      'Too many tries. Please wait 5 minutes and try again.',
    );
    expect(tooMany(undefined)).toBe(
      'Too many tries. Please wait 60 seconds and try again.',
    );
  });
});

describe('creating an account', () => {
  const form = {
    fullName: '  Asha Verma ',
    email: ' asha@example.com ',
    password: 'a long password',
  };

  it('is for visitors: a signed-in customer goes to the account', async () => {
    expect(await load(signUpLoader, '/sign-up', SIGNED_IN)).toMatchObject({
      status: 302,
      location: '/account',
    });
    expect((await load(signUpLoader, '/sign-up')).status).toBe(200);
  });

  it('asks the API to make the account, and says to check the inbox', async () => {
    fetchMock.mockResolvedValue(accepted());
    const { handle, run } = sendTo(signUpAction, '/sign-up', form);

    const result = await run();

    expect(result).toMatchObject({
      status: 200,
      data: { done: true, email: 'asha@example.com' },
    });
    expect(sent()).toEqual({
      url: `${API}/auth/register`,
      method: 'POST',
      body: {
        email: 'asha@example.com',
        password: 'a long password',
        fullName: 'Asha Verma',
      },
    });
    // Not signed in: the address is confirmed first.
    expect(handle.current).toBeNull();
    expect(handle.changed).toBe(false);
  });

  it('says what to fix before asking the API, keeps the name and address, never the password', async () => {
    for (const [fields, problems] of [
      [
        {},
        {
          fullName: 'Enter your name.',
          email: 'Enter your email address.',
          password: 'Choose a password.',
        },
      ],
      [
        { ...form, password: 'too short' },
        { password: 'Choose a password with at least 10 characters.' },
      ],
      [
        { ...form, fullName: 'a'.repeat(101), email: 'asha' },
        {
          fullName: 'A name has at most 100 characters.',
          email: 'Enter an email address like name@example.com.',
        },
      ],
    ] as const) {
      const result = await sendTo(signUpAction, '/sign-up', fields).run();
      expect(result.status).toBe(400);
      expect(problemsOf(result.data)).toEqual(problems);
      expect(JSON.stringify(result.data)).not.toContain('too short');
    }
    const kept = await sendTo(signUpAction, '/sign-up', {
      ...form,
      password: 'too short',
    }).run();
    expect(kept.data).toMatchObject({
      fullName: 'Asha Verma',
      email: 'asha@example.com',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says how long to wait, what the API refused, and when the shop is resting', async () => {
    const tries = [
      [
        answer(429, { message: 'x' }, { 'retry-after': '300' }),
        429,
        { form: 'Too many tries. Please wait 5 minutes and try again.' },
      ],
      [
        answer(400, {
          message: 'Validation failed',
          errors: [{ field: 'email', message: 'Invalid email' }],
        }),
        400,
        { email: 'Enter an email address like name@example.com.' },
      ],
      [
        answer(400, {
          message: 'Validation failed',
          errors: [{ field: 'password', message: 'Too weak' }],
        }),
        400,
        { password: 'Choose a password with at least 10 characters.' },
      ],
      [
        answer(400, {
          message: 'Validation failed',
          errors: [{ field: 'fullName', message: 'Name is required' }],
        }),
        400,
        { fullName: 'Enter your name.' },
      ],
      [
        answer(400, { message: 'Something else' }),
        503,
        {
          form: 'We could not create your account just now. Please try again in a minute.',
        },
      ],
      [
        answer(503, { message: 'x' }),
        503,
        {
          form: 'We could not create your account just now. Please try again in a minute.',
        },
      ],
    ] as const;
    for (const [response, status, problems] of tries) {
      fetchMock.mockResolvedValueOnce(response);
      const result = await sendTo(signUpAction, '/sign-up', form).run();
      expect([result.status, problemsOf(result.data)]).toEqual([
        status,
        problems,
      ]);
    }
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await sendTo(signUpAction, '/sign-up', form).run()).status).toBe(
      503,
    );
  });
});

describe('confirming the email address', () => {
  it('opening the link asks nothing of the API, so a mail scanner can’t use it up', async () => {
    expect(
      (await load(verifyLoader, `/verify-email?token=${TOKEN}`)).data,
    ).toMatchObject({ token: TOKEN, broken: false });
    expect((await load(verifyLoader, '/verify-email')).data).toMatchObject({
      token: null,
      broken: false,
    });
    expect(
      (await load(verifyLoader, '/verify-email?token=cut-short')).data,
    ).toMatchObject({ token: null, broken: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the button sends the token to the API', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { message: 'Email address verified.' }),
    );
    const result = await sendTo(verifyAction, '/verify-email', {
      intent: 'confirm',
      token: TOKEN,
    }).run();
    expect(result).toMatchObject({
      status: 200,
      data: { done: true, sentTo: null },
    });
    expect(sent()).toEqual({
      url: `${API}/auth/verify-email`,
      method: 'POST',
      body: { token: TOKEN },
    });
  });

  it('a form with only a token confirms, never sends a new link', async () => {
    fetchMock.mockResolvedValue(answer(200, { message: 'Verified.' }));
    await sendTo(verifyAction, '/verify-email', { token: TOKEN }).run();
    expect(sent().url).toBe(`${API}/auth/verify-email`);
  });

  it('says when the link has expired or was used, and offers a new one', async () => {
    fetchMock.mockResolvedValue(
      answer(400, { message: 'Invalid or expired verification link' }),
    );
    const result = await sendTo(verifyAction, '/verify-email', {
      intent: 'confirm',
      token: TOKEN,
    }).run();
    expect(result.status).toBe(400);
    expect(result.data).toMatchObject({
      intent: 'confirm',
      linkFailed: true,
      problems: {
        form: 'This link has expired or has been used already. A link lasts 24 hours and works once.',
      },
    });
  });

  it('sends nothing for a token cut short', async () => {
    const result = await sendTo(verifyAction, '/verify-email', {
      intent: 'confirm',
      token: 'cut-short',
    }).run();
    expect(result.data).toMatchObject({ linkFailed: true });
    expect(problemsOf(result.data).form).toContain(
      'This link is not complete.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says how long to wait, and when the shop is resting, keeping the link', async () => {
    fetchMock
      .mockResolvedValueOnce(
        answer(429, { message: 'x' }, { 'retry-after': '30' }),
      )
      .mockResolvedValueOnce(answer(500, { message: 'x' }));
    const fields = { intent: 'confirm', token: TOKEN };
    const busy = await sendTo(verifyAction, '/verify-email', fields).run();
    expect(busy).toMatchObject({ status: 429, data: { linkFailed: false } });
    expect(problemsOf(busy.data).form).toBe(
      'Too many tries. Please wait 30 seconds and try again.',
    );
    const resting = await sendTo(verifyAction, '/verify-email', fields).run();
    expect(resting).toMatchObject({ status: 503, data: { linkFailed: false } });
  });

  it('sends a new link to an address', async () => {
    fetchMock.mockResolvedValue(accepted());
    const result = await sendTo(verifyAction, '/verify-email', {
      intent: 'resend',
      email: ' asha@example.com ',
    }).run();
    expect(result.data).toEqual({ done: true, sentTo: 'asha@example.com' });
    expect(sent()).toEqual({
      url: `${API}/auth/resend-verification`,
      method: 'POST',
      body: { email: 'asha@example.com' },
    });
  });

  it('checks the address before asking, and says how long to wait', async () => {
    const wrong = await sendTo(verifyAction, '/verify-email', {
      intent: 'resend',
      email: 'asha',
    }).run();
    expect(wrong).toMatchObject({
      status: 400,
      data: {
        intent: 'resend',
        email: 'asha',
        problems: { email: 'Enter an email address like name@example.com.' },
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      answer(429, { message: 'x' }, { 'retry-after': '600' }),
    );
    const busy = await sendTo(verifyAction, '/verify-email', {
      intent: 'resend',
      email: 'asha@example.com',
    }).run();
    expect(busy.status).toBe(429);
    expect(problemsOf(busy.data).form).toBe(
      'Too many tries. Please wait 10 minutes and try again.',
    );
  });
});

describe('forgot password', () => {
  it('asks the API to email a link, and says to check the inbox', async () => {
    fetchMock.mockResolvedValue(accepted());
    expect((await load(forgotLoader, '/forgot-password')).status).toBe(200);
    const result = await sendTo(forgotAction, '/forgot-password', {
      email: ' asha@example.com ',
    }).run();
    expect(result.data).toEqual({ done: true, email: 'asha@example.com' });
    expect(sent()).toEqual({
      url: `${API}/auth/forgot-password`,
      method: 'POST',
      body: { email: 'asha@example.com' },
    });
  });

  it('checks the address first, says how long to wait, and when the shop is resting', async () => {
    const wrong = await sendTo(forgotAction, '/forgot-password', {
      email: '',
    }).run();
    expect(problemsOf(wrong.data)).toEqual({
      email: 'Enter your email address.',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(
        answer(429, { message: 'x' }, { 'retry-after': '120' }),
      )
      .mockResolvedValueOnce(answer(503, { message: 'x' }));
    const fields = { email: 'asha@example.com' };
    const busy = await sendTo(forgotAction, '/forgot-password', fields).run();
    expect([busy.status, problemsOf(busy.data).form]).toEqual([
      429,
      'Too many tries. Please wait 2 minutes and try again.',
    ]);
    const resting = await sendTo(
      forgotAction,
      '/forgot-password',
      fields,
    ).run();
    expect([resting.status, problemsOf(resting.data).form]).toEqual([
      503,
      'We could not send the link just now. Please try again in a minute.',
    ]);
  });
});

describe('choosing a new password', () => {
  it('opening the link asks nothing of the API; without a link, the way to get one', async () => {
    expect(
      (await load(resetLoader, `/reset-password?token=${TOKEN}`)).data,
    ).toMatchObject({ token: TOKEN });
    expect(
      (await load(resetLoader, '/reset-password?token=cut')).data,
    ).toMatchObject({ token: null });
    expect(await load(resetLoader, '/reset-password')).toMatchObject({
      status: 302,
      location: '/forgot-password',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sets the new password with the link’s token, and signs out here', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { message: 'Your password has been changed.' }),
    );
    const { handle, run } = sendTo(
      resetAction,
      '/reset-password',
      { token: TOKEN, password: 'a new long password' },
      SIGNED_IN,
    );

    const result = await run();

    expect(result.data).toEqual({ done: true });
    expect(sent()).toEqual({
      url: `${API}/auth/reset-password`,
      method: 'POST',
      body: { token: TOKEN, newPassword: 'a new long password' },
    });
    expect(handle.current).toBeNull();
    expect(handle.changed).toBe(true);
  });

  it('touches no cookie for a visitor', async () => {
    fetchMock.mockResolvedValue(answer(200, { message: 'Changed.' }));
    const { handle, run } = sendTo(resetAction, '/reset-password', {
      token: TOKEN,
      password: 'a new long password',
    });
    await run();
    expect(handle.changed).toBe(false);
  });

  it('checks the password and the token before asking, and never sends the password back', async () => {
    const short = await sendTo(resetAction, '/reset-password', {
      token: TOKEN,
      password: 'too short',
    }).run();
    expect(short).toMatchObject({
      status: 400,
      data: {
        linkFailed: false,
        problems: {
          password: 'Choose a password with at least 10 characters.',
        },
      },
    });
    expect(JSON.stringify(short.data)).not.toContain('too short');

    const cut = await sendTo(resetAction, '/reset-password', {
      token: 'cut',
      password: 'a new long password',
    }).run();
    expect(cut.data).toMatchObject({ linkFailed: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says when the link has expired or was used, what the API refused, how long to wait, and when the shop is resting', async () => {
    const tries = [
      [
        answer(400, { message: 'Invalid or expired reset link' }),
        400,
        true,
        {
          form: 'This link has expired or has been used already. A link lasts 30 minutes and works once.',
        },
      ],
      [
        answer(400, {
          message: 'Validation failed',
          errors: [{ field: 'newPassword', message: 'Too short' }],
        }),
        400,
        false,
        { password: 'Choose a password with at least 10 characters.' },
      ],
      [
        answer(429, { message: 'x' }, { 'retry-after': '60' }),
        429,
        false,
        { form: 'Too many tries. Please wait 60 seconds and try again.' },
      ],
      [
        answer(503, { message: 'x' }),
        503,
        false,
        {
          form: 'We could not change your password just now. Please try again in a minute.',
        },
      ],
    ] as const;
    for (const [response, status, linkFailed, problems] of tries) {
      fetchMock.mockResolvedValueOnce(response);
      const { handle, run } = sendTo(
        resetAction,
        '/reset-password',
        { token: TOKEN, password: 'a new long password' },
        SIGNED_IN,
      );
      const result = await run();
      expect([result.status, result.data]).toEqual([
        status,
        { linkFailed, problems },
      ]);
      // Still signed in: nothing changed.
      expect(handle.current).not.toBeNull();
    }
  });
});

describe('a page whose address holds a link’s token', () => {
  it('is kept by no cache', async () => {
    const response = (await keepOutOfCaches(
      {} as never,
      async () =>
        new Response('page', {
          headers: { 'Cache-Control': 'private, no-cache' },
        }),
    )) as Response;
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(verifyMiddleware).toContain(keepOutOfCaches);
    expect(resetMiddleware).toContain(keepOutOfCaches);
  });
});
