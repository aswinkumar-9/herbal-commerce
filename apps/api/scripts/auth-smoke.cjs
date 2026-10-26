// End-to-end check of customer sign-up and sign-in against the running API.
// Needs the API (pnpm api:dev) and Mailpit (docker compose) to be running.
// Each run creates one throwaway customer account in the local database.
// `pnpm api:smoke` clears the local rate limits first, so it can run again at once.
const API = process.env.API_URL ?? 'http://localhost:3000';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const LOGOUT_LIMIT = 120; // per IP per minute, see rate-limits.ts
const EMAILS_PER_ADDRESS = 5; // per hour, see rate-limits.ts

const email = `smoke.${Date.now()}@example.com`;
const password = 'smoke-test-password-1';
const newPassword = 'smoke-new-password-2';
let failures = 0;

function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    failures += 1;
  }
}

async function call(method, path, { json, form, token, headers: extra } = {}) {
  const headers = { ...extra };
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = new URLSearchParams(form);
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(API + path, { method, headers, body });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : undefined,
  };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 500));

// The emails Mailpit holds for this address with this subject, newest first.
async function mailSearch(address, subject) {
  const query = encodeURIComponent(`to:${address} subject:"${subject}"`);
  return fetch(`${MAILPIT}/api/v1/search?query=${query}`).then((response) =>
    response.json(),
  );
}

// Waits up to 5 seconds, because some emails are sent in the background.
async function waitForEmail(address, subject) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (((await mailSearch(address, subject)).messages ?? []).length > 0) {
      return true;
    }
    await pause();
  }
  return false;
}

// Reads the token from the newest email with this subject.
async function emailedToken(address, subject) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = (await mailSearch(address, subject)).messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${id}`).then(
        (response) => response.json(),
      );
      const match = /token=([A-Za-z0-9_-]+)/.exec(message.Text ?? '');
      if (match) {
        return match[1];
      }
    }
    await pause();
  }
  throw new Error(`no "${subject}" email found in Mailpit`);
}

async function main() {
  const health = await call('GET', '/health/ready');
  check('health is public and ready', health.status === 200);
  check(
    'security headers are set and X-Powered-By is gone',
    health.headers.get('x-content-type-options') === 'nosniff' &&
      health.headers.get('x-powered-by') === null,
  );

  const form = await call('POST', '/v1/auth/register', {
    form: { email, password, fullName: 'Smoke Test' },
  });
  check('a form body is refused (JSON only)', form.status === 400);

  const registered = await call('POST', '/v1/auth/register', {
    json: { email, password, fullName: 'Smoke Test' },
  });
  check('register answers 202', registered.status === 202);

  const early = await call('POST', '/v1/auth/login', { json: { email, password } });
  check('login before verifying the email answers 401', early.status === 401);

  const verified = await call('POST', '/v1/auth/verify-email', {
    json: { token: await emailedToken(email, 'Verify your email address') },
  });
  check('verify-email answers 200', verified.status === 200);

  const login = await call('POST', '/v1/auth/login', { json: { email, password } });
  check(
    'login answers 200 with both tokens',
    login.status === 200 &&
      Boolean(login.body?.accessToken && login.body?.refreshToken),
  );
  check(
    'the login response must not be cached',
    login.headers.get('cache-control') === 'no-store',
  );

  const wrong = await call('POST', '/v1/auth/login', {
    json: { email, password: 'wrong-password-1' },
  });
  const unknown = await call('POST', '/v1/auth/login', {
    json: { email: `nobody.${Date.now()}@example.com`, password },
  });
  check(
    'a wrong password and an unknown email get the same 401',
    wrong.status === 401 &&
      unknown.status === 401 &&
      wrong.body?.message === unknown.body?.message,
  );

  const me = await call('GET', '/v1/me', { token: login.body.accessToken });
  check(
    'GET /v1/me returns the own profile without the password hash',
    me.status === 200 &&
      me.body?.email === email &&
      !('passwordHash' in (me.body ?? {})),
  );
  check(
    'the profile response must not be cached',
    me.headers.get('cache-control') === 'no-store',
  );
  check(
    'GET /v1/me without a token answers 401',
    (await call('GET', '/v1/me')).status === 401,
  );

  const refreshed = await call('POST', '/v1/auth/refresh', {
    json: { refreshToken: login.body.refreshToken },
  });
  check(
    'refresh answers 200 with a new refresh token',
    refreshed.status === 200 &&
      refreshed.body?.refreshToken !== login.body.refreshToken,
  );
  const reused = await call('POST', '/v1/auth/refresh', {
    json: { refreshToken: login.body.refreshToken },
  });
  check('reusing the old refresh token answers 401', reused.status === 401);
  check(
    'after the reuse, even the newest access token is refused',
    (await call('GET', '/v1/me', { token: refreshed.body.accessToken }))
      .status === 401,
  );

  const second = await call('POST', '/v1/auth/login', { json: { email, password } });
  const logout = await call('POST', '/v1/auth/logout', {
    json: { refreshToken: second.body.refreshToken },
  });
  check('logout answers 204', logout.status === 204);
  check(
    'after logout, the access token is refused at once',
    (await call('GET', '/v1/me', { token: second.body.accessToken })).status ===
      401,
  );

  // Rate limits. One logout already happened above, so the request number
  // LOGOUT_LIMIT below is the first one over the limit. Each request claims a
  // different client IP; that must not help, because no proxy is trusted.
  let refused;
  for (let i = 1; i <= LOGOUT_LIMIT + 5 && !refused; i += 1) {
    const response = await call('POST', '/v1/auth/logout', {
      json: { refreshToken: 'x'.repeat(43) },
      headers: { 'X-Forwarded-For': `198.51.100.${i}` },
    });
    if (response.status === 429) {
      refused = { at: i, response };
    }
  }
  check(
    `logout is limited to ${LOGOUT_LIMIT} per minute per IP, even with a faked X-Forwarded-For`,
    refused?.at === LOGOUT_LIMIT,
  );
  check(
    'the 429 says when to try again (Retry-After) and has code RATE_LIMITED',
    Number(refused?.response.headers.get('retry-after')) > 0 &&
      refused?.response.body?.code === 'RATE_LIMITED',
  );

  // A session that is still live, to prove later that a password reset ends it.
  // (It also resets this email and IP to zero failed logins.)
  const live = await call('POST', '/v1/auth/login', { json: { email, password } });

  // Brute-force protection: 5 wrong passwords are allowed, the 6th starts a block.
  const attempts = [];
  for (let i = 0; i < 6; i += 1) {
    const attempt = await call('POST', '/v1/auth/login', {
      json: { email, password: 'wrong-password-1' },
    });
    attempts.push(attempt.status);
  }
  check(
    '5 wrong passwords in a row answer 401, the 6th answers 429',
    attempts.join(',') === '401,401,401,401,401,429',
  );
  const blocked = await call('POST', '/v1/auth/login', { json: { email, password } });
  check(
    'while blocked, even the right password answers 429 (it is not even checked)',
    blocked.status === 429 && Number(blocked.headers.get('retry-after')) > 0,
  );

  // Password recovery: the same answer for every email, a link only for a
  // real account.
  const nobody = `nobody.${Date.now()}@example.com`;
  const forgotUnknown = await call('POST', '/v1/auth/forgot-password', {
    json: { email: nobody },
  });
  const forgotKnown = await call('POST', '/v1/auth/forgot-password', {
    json: { email },
  });
  check(
    'forgot-password answers 202 with the same message for known and unknown emails',
    forgotUnknown.status === 202 &&
      forgotKnown.status === 202 &&
      forgotUnknown.body?.message === forgotKnown.body?.message,
  );
  const resetToken = await emailedToken(email, 'Reset your password').catch(
    () => undefined,
  );
  check('the real account receives a reset link by email', Boolean(resetToken));
  check(
    'an unknown address receives nothing',
    ((await mailSearch(nobody, 'Reset your password')).messages ?? []).length ===
      0,
  );

  // Choosing a new password with the link.
  const reset = await call('POST', '/v1/auth/reset-password', {
    json: { token: resetToken, newPassword },
  });
  check('reset-password answers 200 with the link from the email', reset.status === 200);
  check(
    'the reset ended every session: the live access and refresh tokens are refused',
    (await call('GET', '/v1/me', { token: live.body?.accessToken })).status ===
      401 &&
      (
        await call('POST', '/v1/auth/refresh', {
          json: { refreshToken: live.body?.refreshToken },
        })
      ).status === 401,
  );
  check(
    'the reset lifted the login block: the new password works at once',
    (await call('POST', '/v1/auth/login', { json: { email, password: newPassword } }))
      .status === 200,
  );
  check(
    'the old password no longer works',
    (await call('POST', '/v1/auth/login', { json: { email, password } })).status ===
      401,
  );
  const reusedLink = await call('POST', '/v1/auth/reset-password', {
    json: { token: resetToken, newPassword: 'another-password-3' },
  });
  check('a reset link works only once', reusedLink.status === 400);
  check(
    'the owner is told by email that the password was changed',
    await waitForEmail(email, 'Your password was changed'),
  );

  // At most 5 emails an hour to one address. Register and forgot-password
  // already sent 2, so only 3 more resend requests are allowed. (The
  // "password changed" notice is not counted: nobody can request it.)
  const alreadySent = 2;
  const resends = [];
  for (let i = alreadySent; i <= EMAILS_PER_ADDRESS; i += 1) {
    const resend = await call('POST', '/v1/auth/resend-verification', {
      json: { email },
    });
    resends.push(resend.status);
  }
  check(
    `one address gets at most ${EMAILS_PER_ADDRESS} emails an hour: the next resend answers 429`,
    resends.join(',') === '202,202,202,429',
  );

  console.log(
    failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`\nSmoke test stopped: ${error.message}`);
  console.error('Are the API (pnpm api:dev) and Mailpit (docker compose) running?');
  process.exitCode = 1;
});
