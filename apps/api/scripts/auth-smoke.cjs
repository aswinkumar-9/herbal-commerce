// End-to-end check of customer sign-up, sign-in, the customer's own account and
// the public shop (categories, products and prices) against the running API,
// and that customers can never use the staff routes.
// Needs the API (pnpm api:dev) and Mailpit (docker compose) to be running.
// Each run creates two throwaway customer accounts in the local database.
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

// Waits up to 5 seconds, because some emails are sent in the background, until
// Mailpit holds at least `count` of them.
async function waitForEmail(address, subject, count = 1) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (((await mailSearch(address, subject)).messages ?? []).length >= count) {
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

  // The staff routes are a separate world: a customer's password and tokens
  // never open them. (The staff login itself is tried by hand, with a phone.)
  const staffAsCustomer = await call('POST', '/v1/staff/auth/login', {
    json: { email, password, code: '000000' },
  });
  const staffAsNobody = await call('POST', '/v1/staff/auth/login', {
    json: { email: `nobody.${Date.now()}@example.com`, password, code: '000000' },
  });
  check(
    'the staff login gives a customer and an unknown email the same 401',
    staffAsCustomer.status === 401 &&
      staffAsNobody.status === 401 &&
      staffAsCustomer.body?.message === 'Invalid email, password or code' &&
      staffAsCustomer.body?.message === staffAsNobody.body?.message,
  );
  check(
    'a customer access token is refused on GET /v1/staff/me',
    (await call('GET', '/v1/staff/me', { token: login.body.accessToken }))
      .status === 401,
  );
  check(
    'a customer access token cannot invite an Admin on POST /v1/staff/admins',
    (
      await call('POST', '/v1/staff/admins', {
        json: { email: `smoke.admin.${Date.now()}@example.com`, fullName: 'Smoke Admin' },
        token: login.body.accessToken,
      })
    ).status === 401,
  );
  // The other Admin routes refuse it too. The token is checked before the
  // ID, so any well-formed ID will do.
  const anyId = '00000000-0000-4000-8000-000000000000';
  const adminRoutes = [
    ['GET', '/v1/staff/admins'],
    ['PATCH', `/v1/staff/admins/${anyId}`, { status: 'DISABLED' }],
    ['DELETE', `/v1/staff/admins/${anyId}`],
    ['POST', `/v1/staff/admins/${anyId}/invitation`],
  ];
  const adminAnswers = [];
  for (const [method, path, json] of adminRoutes) {
    const answer = await call(method, path, {
      json,
      token: login.body.accessToken,
    });
    adminAnswers.push(answer.status);
  }
  check(
    'a customer access token cannot list, disable, remove or re-invite Admins',
    adminAnswers.every((status) => status === 401),
  );
  check(
    'a customer access token cannot read the audit log on GET /v1/staff/audit-log',
    (
      await call('GET', '/v1/staff/audit-log', {
        token: login.body.accessToken,
      })
    ).status === 401,
  );

  // Accepting an invitation is public, but only a real link works. (A real
  // invitation is tried by hand: only a signed-in Super User can send one.)
  const madeUpInvite = await call('POST', '/v1/staff/auth/accept-invite', {
    json: { token: 'x'.repeat(43), password: 'smoke-staff-password-1' },
  });
  check(
    'accept-invite refuses a made-up link with 400',
    madeUpInvite.status === 400 &&
      madeUpInvite.body?.message === 'Invalid or expired invitation link',
  );

  // Refused and left alone: the next check still refreshes with this token.
  check(
    'a customer refresh token is refused on the staff refresh',
    (
      await call('POST', '/v1/staff/auth/refresh', {
        json: { refreshToken: login.body.refreshToken },
      })
    ).status === 401,
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

  // The customer's own account (part 3C-1). The password is newPassword now.
  const mine = await call('POST', '/v1/auth/login', {
    json: { email, password: newPassword },
  });
  const renamed = await call('PATCH', '/v1/me', {
    json: { fullName: ' Smoke Renamed ', role: 'ADMIN', email: `x.${email}` },
    token: mine.body?.accessToken,
  });
  check(
    'PATCH /v1/me changes the name, trimmed, and nothing else',
    renamed.status === 200 &&
      renamed.body?.fullName === 'Smoke Renamed' &&
      renamed.body?.role === 'CUSTOMER' &&
      renamed.body?.email === email,
  );

  // A second device, to prove that a password change signs out everywhere.
  const otherDevice = await call('POST', '/v1/auth/login', {
    json: { email, password: newPassword },
  });
  const changedPassword = 'smoke-changed-password-3';
  const wrongCurrent = await call('POST', '/v1/me/password', {
    json: { currentPassword: 'not-the-password-1', newPassword: changedPassword },
    token: mine.body?.accessToken,
  });
  check(
    'changing the password with a wrong current one answers 400',
    wrongCurrent.status === 400,
  );
  const notices = ((await mailSearch(email, 'Your password was changed'))
    .messages ?? []).length;
  const changed = await call('POST', '/v1/me/password', {
    json: { currentPassword: newPassword, newPassword: changedPassword },
    token: mine.body?.accessToken,
  });
  check(
    'changing the password with the current one answers 200',
    changed.status === 200,
  );
  check(
    'the change ended every session: this device and the other one',
    (await call('GET', '/v1/me', { token: mine.body?.accessToken })).status ===
      401 &&
      (await call('GET', '/v1/me', { token: otherDevice.body?.accessToken }))
        .status === 401,
  );
  const oldOne = await call('POST', '/v1/auth/login', {
    json: { email, password: newPassword },
  });
  const one = await call('POST', '/v1/auth/login', {
    json: { email, password: changedPassword },
  });
  check(
    'after the change, only the new password signs in',
    oldOne.status === 401 && one.status === 200,
  );
  check(
    'the owner is told by email that the password was changed',
    await waitForEmail(email, 'Your password was changed', notices + 1),
  );

  // Sign out everywhere: both live sessions end, refresh tokens included.
  const two = await call('POST', '/v1/auth/login', {
    json: { email, password: changedPassword },
  });
  const everywhere = await call('DELETE', '/v1/me/sessions', {
    token: one.body?.accessToken,
  });
  check('DELETE /v1/me/sessions answers 204', everywhere.status === 204);
  check(
    'after signing out everywhere, both devices are refused, refresh included',
    (await call('GET', '/v1/me', { token: one.body?.accessToken })).status ===
      401 &&
      (await call('GET', '/v1/me', { token: two.body?.accessToken })).status ===
        401 &&
      (
        await call('POST', '/v1/auth/refresh', {
          json: { refreshToken: two.body?.refreshToken },
        })
      ).status === 401,
  );
  // Delivery addresses (part 3C-2). A fresh sign-in: every session ended above.
  const owner = await call('POST', '/v1/auth/login', {
    json: { email, password: changedPassword },
  });
  const ownerToken = owner.body?.accessToken;
  const home = {
    fullName: 'Smoke Home',
    phone: '+91 98450 12345',
    line1: '12, 3rd Cross, Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560 038',
  };
  // A double tap: two first addresses at the same moment. The row lock makes
  // them take turns, so both are saved and exactly one is the default.
  const [firstA, firstB] = await Promise.all([
    call('POST', '/v1/me/addresses', { json: home, token: ownerToken }),
    call('POST', '/v1/me/addresses', {
      json: { ...home, line1: '14, 3rd Cross, Indiranagar' },
      token: ownerToken,
    }),
  ]);
  check(
    'two addresses added at the same moment are both saved, with exactly one default',
    firstA.status === 201 &&
      firstB.status === 201 &&
      [firstA.body?.isDefault, firstB.body?.isDefault].filter(Boolean)
        .length === 1,
  );
  check(
    'an address is saved with the phone and the PIN code cleaned',
    firstA.body?.phone === '9845012345' && firstA.body?.pincode === '560038',
  );
  const work = await call('POST', '/v1/me/addresses', {
    json: { ...home, fullName: 'Smoke Work', city: 'Mysuru', isDefault: true },
    token: ownerToken,
  });
  const listed = await call('GET', '/v1/me/addresses', { token: ownerToken });
  check(
    'a new default takes over: 3 addresses, one default, listed first',
    work.status === 201 &&
      listed.body?.addresses?.length === 3 &&
      listed.body.addresses[0].id === work.body?.id &&
      listed.body.addresses.filter((address) => address.isDefault).length ===
        1,
  );
  check(
    'an unknown state and a PIN code starting with 0 answer 400',
    (
      await call('POST', '/v1/me/addresses', {
        json: { ...home, state: 'Bangalore', pincode: '060038' },
        token: ownerToken,
      })
    ).status === 400,
  );

  // Another customer must not see, change or remove those addresses (BOLA).
  const strangerEmail = `smoke.other.${Date.now()}@example.com`;
  await call('POST', '/v1/auth/register', {
    json: { email: strangerEmail, password, fullName: 'Smoke Stranger' },
  });
  await call('POST', '/v1/auth/verify-email', {
    json: {
      token: await emailedToken(strangerEmail, 'Verify your email address'),
    },
  });
  const stranger = await call('POST', '/v1/auth/login', {
    json: { email: strangerEmail, password },
  });
  const strangerToken = stranger.body?.accessToken;
  check(
    "another customer's list is empty",
    (await call('GET', '/v1/me/addresses', { token: strangerToken })).body
      ?.addresses?.length === 0,
  );
  const workPath = `/v1/me/addresses/${work.body?.id}`;
  const strangerChange = await call('PATCH', workPath, {
    json: { city: 'Elsewhere' },
    token: strangerToken,
  });
  const strangerRemove = await call('DELETE', workPath, {
    token: strangerToken,
  });
  check(
    "another customer gets 404 when changing or removing someone else's address",
    strangerChange.status === 404 && strangerRemove.status === 404,
  );

  const changedAddress = await call('PATCH', workPath, {
    json: { city: ' Mysuru North ' },
    token: ownerToken,
  });
  check(
    'the owner changes the address: 200, and the stranger changed nothing',
    changedAddress.status === 200 &&
      changedAddress.body?.city === 'Mysuru North',
  );
  const removedDefault = await call('DELETE', workPath, { token: ownerToken });
  const remaining = await call('GET', '/v1/me/addresses', {
    token: ownerToken,
  });
  check(
    'removing the default answers 204, and another address becomes the default',
    removedDefault.status === 204 &&
      remaining.body?.addresses?.length === 2 &&
      remaining.body.addresses.filter((address) => address.isDefault)
        .length === 1 &&
      !remaining.body.addresses.some((address) => address.id === work.body?.id),
  );
  // Product categories (part 4A). Anyone may read the active ones. Staff
  // manage them, which is tried by hand with a phone.
  const shop = await call('GET', '/v1/categories');
  check(
    'GET /v1/categories is public, with only the name, slug and description of each',
    shop.status === 200 &&
      Array.isArray(shop.body?.categories) &&
      shop.body.categories.every(
        (category) =>
          Object.keys(category).sort().join() === 'description,name,slug',
      ),
  );
  const shopSignedIn = await call('GET', '/v1/categories', {
    token: ownerToken,
  });
  check(
    'a signed-in customer gets the same category list',
    shopSignedIn.status === 200 &&
      JSON.stringify(shopSignedIn.body) === JSON.stringify(shop.body),
  );
  check(
    'the staff category list without a token answers 401',
    (await call('GET', '/v1/staff/categories')).status === 401,
  );
  const categoryRoutes = [
    ['GET', '/v1/staff/categories'],
    ['POST', '/v1/staff/categories', { name: 'Smoke Category' }],
    ['PATCH', `/v1/staff/categories/${anyId}`, { isActive: true }],
    ['DELETE', `/v1/staff/categories/${anyId}`],
  ];
  const categoryAnswers = [];
  for (const [method, path, json] of categoryRoutes) {
    const answer = await call(method, path, { json, token: ownerToken });
    categoryAnswers.push(answer.status);
  }
  check(
    'a customer access token cannot list, create, change or delete categories',
    categoryAnswers.every((status) => status === 401),
  );
  // Products (part 4B). The shop is public: a category's page and a product's
  // page. Staff manage products, which is tried by hand with a phone.
  const missingSlug = `no-such-page-${Date.now()}`;
  const unknownCategory = await call('GET', `/v1/categories/${missingSlug}/products`);
  const unknownProduct = await call('GET', `/v1/products/${missingSlug}`);
  check(
    'an unknown category page and an unknown product page answer 404, without a token',
    unknownCategory.status === 404 &&
      unknownCategory.body?.message === 'Category not found' &&
      unknownProduct.status === 404 &&
      unknownProduct.body?.message === 'Product not found',
  );
  check(
    'a category page refuses more than 50 products at once with 400',
    (await call('GET', `/v1/categories/${missingSlug}/products?limit=51`)).status ===
      400,
  );
  // Every active category's page, and every product page it links to, show
  // only what a shop needs: no IDs and no staff fields. With an empty shop
  // there is nothing to look at; the manual test fills it.
  const categoryPages = [];
  for (const category of shop.body?.categories ?? []) {
    categoryPages.push(
      await call('GET', `/v1/categories/${category.slug}/products`),
    );
  }
  check(
    "each active category's page shows the category, and only the name, slug, summary and from-price of its products",
    categoryPages.every(
      (page) =>
        page.status === 200 &&
        Object.keys(page.body).sort().join() === 'category,nextAfter,products' &&
        Object.keys(page.body.category).sort().join() ===
          'description,name,slug' &&
        page.body.products.every(
          (product) =>
            Object.keys(product).sort().join() ===
            'fromPricePaise,name,slug,summary',
        ),
    ),
  );
  // Each card with the page it links to, to compare their prices (part 4C).
  const productPages = [];
  for (const page of categoryPages) {
    for (const card of page.body?.products ?? []) {
      productPages.push({
        card,
        page: await call('GET', `/v1/products/${card.slug}`),
      });
    }
  }
  const PAGE_FIELDS = [
    'category',
    'countryOfOrigin',
    'description',
    'ingredients',
    'licenceNumber',
    'manufacturerAddress',
    'manufacturerName',
    'name',
    'slug',
    'summary',
    'type',
    'usage',
    'variants',
  ].join();
  check(
    "each product's page shows its licence and maker details, and no IDs or staff fields",
    productPages.every(
      ({ page }) =>
        page.status === 200 &&
        Object.keys(page.body).sort().join() === PAGE_FIELDS &&
        Boolean(page.body.licenceNumber && page.body.manufacturerName),
    ),
  );
  check(
    "each pack on a product's page shows only its SKU, size and prices, and never a price above its MRP",
    productPages.every(({ page }) =>
      (page.body?.variants ?? []).every(
        (pack) =>
          Object.keys(pack).sort().join() ===
            'mrpPaise,pricePaise,quantity,sku,unit' &&
          pack.pricePaise <= pack.mrpPaise,
      ),
    ),
  );
  check(
    "each card's from-price is the lowest price on the product's page, or null without a pack on sale",
    productPages.every(({ card, page }) => {
      const prices = (page.body?.variants ?? []).map((pack) => pack.pricePaise);
      const lowest = prices.length > 0 ? Math.min(...prices) : null;
      return card.fromPricePaise === lowest;
    }),
  );
  const productRoutes = [
    ['GET', '/v1/staff/products'],
    ['POST', '/v1/staff/products', { categoryId: anyId, name: 'Smoke Product' }],
    ['PATCH', `/v1/staff/products/${anyId}`, { name: 'Smoke Product' }],
    ['DELETE', `/v1/staff/products/${anyId}`],
  ];
  const productAnswers = [];
  for (const [method, path, json] of productRoutes) {
    const answer = await call(method, path, { json, token: ownerToken });
    productAnswers.push(answer.status);
  }
  check(
    'a customer access token cannot list, create, change or delete products',
    productAnswers.every((status) => status === 401),
  );

  // Pack sizes and prices (part 4C) are for staff only too.
  const packRoutes = [
    ['GET', `/v1/staff/products/${anyId}/variants`],
    [
      'POST',
      `/v1/staff/products/${anyId}/variants`,
      { sku: 'SMOKE-1', quantity: 1, unit: 'PIECES', mrpPaise: 100, pricePaise: 100 },
    ],
    ['PATCH', `/v1/staff/variants/${anyId}`, { pricePaise: 100 }],
    ['DELETE', `/v1/staff/variants/${anyId}`],
  ];
  const packAnswers = [];
  for (const [method, path, json] of packRoutes) {
    const answer = await call(method, path, { json, token: ownerToken });
    packAnswers.push(answer.status);
  }
  check(
    'a customer access token cannot list, add, change or delete pack sizes',
    packAnswers.every((status) => status === 401),
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
