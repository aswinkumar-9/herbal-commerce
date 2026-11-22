// Checks the built website before it can be served (part of `pnpm
// web:build`, ADR 0039). It starts the built website on a spare port, with
// a stand-in for the API, and reads its pages as a browser would: the home
// page, the shop and a search, a category, a product, a policy page and
// one not published yet, the account's forms and its emailed links, "not
// found" (404) and an unknown category and product. The API is asked once
// for a page shown again and again (its answer is kept); while the API is
// busy, the home page just shown still opens, and a search not made before
// says the shop is taking a break (503). Each must carry its own policy with a fresh nonce, every inline
// script that nonce, and no inline style at all. No source map may be
// published, and no font or picture may hide in a data: address. Every
// page preloads the shop's three fonts, the very files its stylesheet
// names. It also signs in and signs up through the built website, as a
// browser would (ADR 0041).
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServerBuild } from 'react-router';

process.env.NODE_ENV = 'production';
// A built website needs a key for its sign-in cookies: a fresh one here.
process.env['WEB_SESSION_SECRET'] = randomBytes(32).toString('base64url');

// The stand-in for the API: one category with one product, or busy when
// asked to be.
let busy = false;
const WELLNESS = { name: 'Wellness', slug: 'wellness', description: null };
const TULSI = {
  name: 'Tulsi Drops',
  slug: 'tulsi-drops',
  summary: 'Holy basil',
  fromPriceRupees: 299,
  imageUrl: 'http://127.0.0.1:3000/media/products/k-small.webp',
};
const ADDRESS_ID = '0b6f3c1e-8f3a-4c55-9a51-3c2b1d7e9f10';
const answers: Record<string, unknown> = {
  '/v1/categories': { categories: [WELLNESS] },
  '/v1/products': {
    products: [{ ...TULSI, inStock: true }],
    total: 1,
    page: 1,
    nextPage: null,
  },
  '/v1/products/tulsi-drops': {
    ...TULSI,
    description: null,
    ingredients: 'Tulsi leaf extract',
    usage: null,
    type: 'AYURVEDIC_MEDICINE',
    licenceNumber: '25D/123/2015',
    manufacturerName: 'Herbal Works',
    manufacturerAddress: 'Mysuru',
    countryOfOrigin: 'India',
    category: { name: WELLNESS.name, slug: WELLNESS.slug },
    variants: [
      {
        sku: 'TUL-30',
        quantity: 30,
        unit: 'ML',
        mrpRupees: 349,
        priceRupees: 299,
        inStock: true,
      },
    ],
    images: [
      {
        url: 'http://127.0.0.1:3000/media/products/k-large.webp',
        thumbnailUrl: TULSI.imageUrl,
        altText: 'Tulsi Drops',
        width: 1200,
        height: 1200,
      },
    ],
  },
  '/v1/categories/wellness/products': {
    category: WELLNESS,
    products: [TULSI],
    nextAfter: null,
  },
  // A customer signing in (any email and password will do), and who they
  // are.
  '/v1/auth/login': {
    accessToken: 'stand.in.access-token',
    tokenType: 'Bearer',
    expiresIn: 900,
    refreshToken: 'stand-in-refresh-token-0123456789',
  },
  '/v1/me': { fullName: 'Asha Verma', email: 'asha@example.com' },
  // Their one delivery address.
  '/v1/me/addresses': [
    {
      id: ADDRESS_ID,
      fullName: 'Asha Verma',
      phone: '9845012345',
      line1: '12 MG Road',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      isDefault: true,
    },
  ],
  '/v1/auth/register': { message: 'If this email address can be used…' },
  // Only the privacy policy is published; the rest answer 404.
  '/v1/policies/privacy': {
    page: 'privacy',
    version: 1,
    body: '## Who we are\n\nA shop.\n\n- One\n- Two',
    publishedAt: '2026-11-21T10:05:00.000Z',
  },
};
// What the website asked the API, by method and path.
const asked: string[] = [];
const api = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://x').pathname;
  asked.push(`${request.method} ${path}`);
  const body = answers[path];
  response.writeHead(busy ? 503 : body ? 200 : 404, {
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(busy || !body ? { message: 'x' } : body));
});
await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
const apiAt = api.address();
process.env['WEB_API_URL'] =
  `http://127.0.0.1:${typeof apiAt === 'object' && apiAt ? apiAt.port : 0}`;

// This folder as Windows spells it, so React loads once (see server.ts).
const web = realpathSync.native(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const problems: string[] = [];
// The font files the built stylesheet names, by their addresses.
const stylesheetFonts = new Set<string>();

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
for (const file of files(join(web, 'build', 'client'))) {
  if (file.endsWith('.map')) {
    problems.push(`source map published: ${file}`);
  } else if (/\.(js|css)$/.test(file)) {
    const content = readFileSync(file, 'utf8');
    if (content.includes('sourceMappingURL=')) {
      problems.push(`points to a source map: ${file}`);
    }
    if (/url\(\s*['"]?data:/.test(content)) {
      problems.push(`a data: address the policy would refuse: ${file}`);
    }
    if (file.endsWith('.css')) {
      for (const [, url] of content.matchAll(/url\(([^)]+\.woff2)\)/g)) {
        stylesheetFonts.add(url ?? '');
      }
    }
  }
}

// The API being out of reach is logged, as it should be; kept quiet here
// unless the check fails.
const logged: unknown[][] = [];
console.error = (...args: unknown[]) => {
  logged.push(args);
};

// The website answers at its own address, WEB_ORIGIN, as it will when it
// is live: forms are taken only from there (ADR 0041).
const port = await new Promise<number>((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const at = probe.address();
    probe.close(() => resolve(typeof at === 'object' && at ? at.port : 0));
  });
});
process.env['WEB_ORIGIN'] = `http://127.0.0.1:${port}`;

const { loadConfig } = await import('../app/config.server.ts');
const { createWebsite } = await import('../server/app.ts');
const build = (await import(
  pathToFileURL(join(web, 'build', 'server', 'index.js')).href
)) as ServerBuild;
const website = createWebsite({
  config: loadConfig(process.env),
  build,
  clientDir: join(web, 'build', 'client'),
});
const server = await new Promise<Server>((resolve) => {
  const listening = website.listen(port, '127.0.0.1', () => resolve(listening));
});
const base = process.env['WEB_ORIGIN'];

const nonces = new Set<string>();
async function checkPage(
  path: string,
  status: number,
  // A page whose address holds a link's token is kept by no cache at all.
  cache = 'private, no-cache',
): Promise<void> {
  const response = await fetch(`${base}${path}`);
  const html = await response.text();
  const where = `${path}:`;
  if (response.status !== status) {
    problems.push(`${where} answered ${response.status}, not ${status}`);
  }
  const policy = response.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
  if (!nonce) {
    problems.push(`${where} has no policy with a nonce`);
    return;
  }
  if (nonces.has(nonce)) {
    problems.push(`${where} reuses a nonce`);
  }
  nonces.add(nonce);
  for (const loose of [
    "'unsafe-inline'",
    "'unsafe-eval'",
    "'unsafe-hashes'",
    'data:',
    ' * ',
  ]) {
    if (policy.includes(loose)) {
      problems.push(`${where} the policy allows ${loose.trim()}`);
    }
  }
  for (const needed of [
    "default-src 'none'",
    "style-src 'self'",
    "require-trusted-types-for 'script'",
    "frame-ancestors 'none'",
  ]) {
    if (!policy.includes(needed)) {
      problems.push(`${where} the policy lacks ${needed}`);
    }
  }
  for (const script of html.match(/<script\b[^>]*>/g) ?? []) {
    if (!/\bsrc=/.test(script) && !script.includes(`nonce="${nonce}"`)) {
      problems.push(
        `${where} an inline script without the page's nonce: ${script}`,
      );
    }
  }
  // Pictures only from the website itself or the shop's media address.
  for (const [, src] of html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)) {
    if (
      !src?.startsWith('/') &&
      !src?.startsWith('http://127.0.0.1:3000/media/')
    ) {
      problems.push(`${where} a picture from elsewhere: ${src}`);
    }
  }
  if (/<style\b|\sstyle=/.test(html)) {
    problems.push(`${where} inline style, which the policy refuses`);
  }
  // The shop's fonts, preloaded from the website itself: the very files
  // the stylesheet names, and marked as the CORS fetch a font always is,
  // or the browser would fetch each one twice.
  const fonts = [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([link]) => link)
    .filter(
      (link) => link.includes('rel="preload"') && link.includes('as="font"'),
    );
  if (fonts.length !== 3) {
    problems.push(`${where} preloads ${fonts.length} fonts, not 3`);
  }
  for (const link of fonts) {
    const href = /\shref="([^"]*)"/.exec(link)?.[1] ?? '';
    if (
      !/^\/assets\/poppins-latin-[456]00-normal-[\w-]{8}\.woff2$/.test(href) ||
      !stylesheetFonts.has(href) ||
      !link.includes('type="font/woff2"') ||
      !link.includes('crossorigin="anonymous"')
    ) {
      problems.push(`${where} a font preload the page would not use: ${link}`);
    }
  }
  // The theme's first step: inline under the page's nonce, before the
  // stylesheet, so nothing is fetched before it runs, and never a file of
  // its own any more (part 14B).
  const themeTag = `<script nonce="${nonce}" data-theme-step="">`;
  const themeAt = html.indexOf(themeTag);
  const themeCode =
    themeAt < 0
      ? ''
      : html.slice(
          themeAt + themeTag.length,
          html.indexOf('</script>', themeAt),
        );
  const styleAt = html.indexOf('rel="stylesheet"');
  if (
    themeAt < 0 ||
    styleAt < 0 ||
    themeAt > styleAt ||
    !themeCode.includes('localStorage')
  ) {
    problems.push(
      `${where} the theme's first step must come, inline with the page's nonce, before the stylesheet`,
    );
  }
  if (html.includes('/assets/theme-init-')) {
    problems.push(`${where} the theme's first step is still fetched as a file`);
  }
  for (const [name, value] of [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['cache-control', cache],
  ]) {
    if (response.headers.get(name ?? '') !== value) {
      problems.push(`${where} ${name} is not ${value}`);
    }
  }
  if (response.headers.has('x-powered-by')) {
    problems.push(`${where} says what it runs on (X-Powered-By)`);
  }
}

// Signing in through the built website (ADR 0041): the account sends a
// visitor to sign in; a form from another site is refused; the form signs
// in and seals the tokens in an HttpOnly cookie; the account page then
// opens with it, is kept by no cache, and shows no token.
async function checkSigningIn(): Promise<void> {
  const where = 'signing in:';
  const away = await fetch(`${base}/account`, { redirect: 'manual' });
  if (
    away.status !== 302 ||
    away.headers.get('location') !== '/sign-in?next=%2Faccount'
  ) {
    problems.push(`${where} /account let a visitor in (${away.status})`);
  }
  const form = {
    method: 'POST',
    redirect: 'manual' as const,
    body: new URLSearchParams({
      email: 'asha@example.com',
      password: 'a long password',
    }),
  };
  const elsewhere = await fetch(`${base}/sign-in`, {
    ...form,
    headers: { origin: 'https://evil.example' },
  });
  if (elsewhere.status !== 403) {
    problems.push(`${where} a form from another site got ${elsewhere.status}`);
  }
  const signedIn = await fetch(`${base}/sign-in`, {
    ...form,
    headers: { origin: base },
  });
  const cookie = signedIn.headers.get('set-cookie') ?? '';
  const sealed =
    /^herbal_session=v1\.[\w-]+\.[\w-]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/;
  if (
    signedIn.status !== 302 ||
    signedIn.headers.get('location') !== '/account' ||
    !sealed.test(cookie) ||
    cookie.includes('stand.in.access-token')
  ) {
    problems.push(
      `${where} the form did not seal a session (${signedIn.status})`,
    );
    return;
  }
  const account = await fetch(`${base}/account`, {
    headers: { cookie: cookie.split(';')[0] ?? '' },
  });
  await checkCache(
    '/account.data',
    'private, no-store',
    cookie.split(';')[0] ?? '',
  );
  // Never kept, even fetched ahead.
  await checkCache(
    '/account.data',
    'private, no-store',
    cookie.split(';')[0] ?? '',
    true,
  );
  const html = await account.text();
  if (
    account.status !== 200 ||
    !html.includes('Asha Verma') ||
    !html.includes('12 MG Road') ||
    html.includes('stand.in.access-token') ||
    html.includes('stand-in-refresh-token') ||
    account.headers.get('cache-control') !== 'private, no-store'
  ) {
    problems.push(
      `${where} the account page did not open as it should (${account.status})`,
    );
  }
  // The account's own pages: a visitor signs in first and comes back; the
  // customer's open, kept by no cache, without a token.
  for (const path of [
    '/account/password',
    '/account/addresses/new',
    `/account/addresses/${ADDRESS_ID}`,
  ]) {
    const visitor = await fetch(`${base}${path}`, { redirect: 'manual' });
    if (
      visitor.status !== 302 ||
      visitor.headers.get('location') !==
        `/sign-in?next=${encodeURIComponent(path)}`
    ) {
      problems.push(`${where} ${path} let a visitor in (${visitor.status})`);
    }
    const page = await fetch(`${base}${path}`, {
      headers: { cookie: cookie.split(';')[0] ?? '' },
    });
    const pageHtml = await page.text();
    if (
      page.status !== 200 ||
      page.headers.get('cache-control') !== 'private, no-store' ||
      pageHtml.includes('stand.in.access-token') ||
      pageHtml.includes('stand-in-refresh-token')
    ) {
      problems.push(
        `${where} ${path} did not open as it should (${page.status}, ${page.headers.get('cache-control')})`,
      );
    }
  }
}

// What a CDN in front of the website would read: the data a page asks for
// as the customer moves on is no shared cache's, like the page itself, and
// a signed-in customer's or a link's none at all; a missing file is never
// kept, or a new release would stay broken for a while.
// `ahead`: asked as the browser asks for a page while its link is pointed
// at. A page's data is always told apart by the cookie.
async function checkCache(
  path: string,
  cache: string,
  cookie = '',
  ahead = false,
): Promise<void> {
  const response = await fetch(`${base}${path}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(ahead ? { 'sec-purpose': 'prefetch' } : {}),
    },
    redirect: 'manual',
  });
  await response.arrayBuffer();
  const where = `${path}${ahead ? ' (fetched ahead)' : ''}:`;
  if (response.headers.get('cache-control') !== cache) {
    problems.push(
      `${where} cache-control is ${response.headers.get('cache-control')}, not ${cache}`,
    );
  }
  if (
    path.includes('.data') &&
    !/\bcookie\b/i.test(response.headers.get('vary') ?? '')
  ) {
    problems.push(`${where} is not told apart by the cookie`);
  }
}

// Brotli for what a browser downloads: each built script and stylesheet
// of 1 kB or more has its copy, sent to a browser that takes it and coming
// back out as the very file; gzip for one that takes only that; the plain
// file otherwise. A page and its data are compressed as they go out.
async function checkCompression(): Promise<void> {
  const where = 'compression:';
  const built = files(join(web, 'build', 'client', 'assets')).filter(
    (file) => /\.(js|css)$/.test(file) && statSync(file).size >= 1024,
  );
  const bare = built.filter((file) => !existsSync(`${file}.br`));
  if (bare.length > 0) {
    problems.push(
      `${where} no Brotli copy of ${bare.map((file) => basename(file)).join(', ')}`,
    );
  }
  const biggest = built.sort((a, b) => statSync(b).size - statSync(a).size)[0];
  if (!biggest) {
    problems.push(`${where} no built scripts`);
    return;
  }
  for (const [accepted, coding] of [
    ['gzip, deflate, br, zstd', 'br'],
    ['gzip', 'gzip'],
    ['identity', null],
  ] as const) {
    const response = await fetch(`${base}/assets/${basename(biggest)}`, {
      headers: { 'accept-encoding': accepted },
    });
    // fetch undoes the coding: what comes out must be the file itself.
    const text = await response.text();
    if (
      response.headers.get('content-encoding') !== coding ||
      response.headers.get('vary') !== 'Accept-Encoding' ||
      text !== readFileSync(biggest, 'utf8')
    ) {
      problems.push(
        `${where} ${basename(biggest)} for "${accepted}" went wrong`,
      );
    }
  }
  for (const path of ['/', '/shop.data']) {
    const response = await fetch(`${base}${path}`, {
      headers: { 'accept-encoding': 'gzip, deflate, br, zstd' },
    });
    const text = await response.text();
    if (
      response.headers.get('content-encoding') !== 'br' ||
      text.length < 100
    ) {
      problems.push(`${where} ${path} was not sent with Brotli`);
    }
  }
}

// Signing up through the built website: the form asks the API to make the
// account and says to check the inbox, without the password. Opening an
// emailed link asks nothing of the API: only its button does, so a mail
// scanner opening every link can't use it up.
const TOKEN = 'Zm9yIGEgdGVzdCBvbmx5IG5vdCBhIHJlYWwgdG9rZW4';
async function checkSigningUp(): Promise<void> {
  const where = 'signing up:';
  const response = await fetch(`${base}/sign-up`, {
    method: 'POST',
    headers: { origin: base },
    body: new URLSearchParams({
      fullName: 'Asha Verma',
      email: 'asha@example.com',
      password: 'a long password',
    }),
  });
  const html = await response.text();
  if (
    response.status !== 200 ||
    !html.includes('Check your inbox') ||
    html.includes('a long password') ||
    !asked.includes('POST /v1/auth/register')
  ) {
    problems.push(`${where} the form did not ask for an account`);
  }
  const before = asked.length;
  await checkPage(`/verify-email?token=${TOKEN}`, 200, 'private, no-store');
  await checkPage(`/reset-password?token=${TOKEN}`, 200, 'private, no-store');
  const opened = asked.slice(before).filter((call) => call.includes('/auth/'));
  if (opened.length > 0) {
    problems.push(
      `opening an emailed link asked the API: ${opened.join(', ')}`,
    );
  }
}

try {
  await checkPage('/', 200);
  await checkPage('/shop', 200);
  await checkPage('/shop?q=tulsi&sort=price-asc', 200);
  await checkPage('/categories/wellness', 200);
  await checkPage('/products/tulsi-drops', 200);
  await checkPage('/privacy', 200);
  await checkPage('/terms', 200);
  await checkPage('/sign-in', 200);
  await checkSigningIn();
  await checkPage('/sign-up', 200);
  await checkPage('/forgot-password', 200);
  await checkPage('/verify-email', 200, 'private, no-store');
  await checkSigningUp();
  await checkPage('/this-page-does-not-exist', 404);
  await checkPage('/categories/no-such-category', 404);
  await checkPage('/products/no-such-product', 404);
  await checkCache('/shop.data', 'private, no-cache');
  await checkCache('/products/tulsi-drops.data', 'private, no-cache');
  // Fetched ahead (a link pointed at): kept 10 seconds for the click, but
  // only a page as it is, never a redirect or "not found".
  await checkCache('/shop.data', 'private, max-age=10', '', true);
  await checkCache('/account.data', 'private, no-cache', '', true);
  await checkCache(
    '/products/no-such-product.data',
    'private, no-cache',
    '',
    true,
  );
  await checkCache(`/reset-password.data?token=${TOKEN}`, 'private, no-store');
  await checkCache('/assets/no-such-file.js', 'no-store');
  await checkCompression();
  // The product's page and its data were both opened by now: the API was
  // asked once, its answer kept (app/api.server.ts).
  const productAsked = asked.filter(
    (call) => call === 'GET /v1/products/tulsi-drops',
  ).length;
  if (productAsked !== 1) {
    problems.push(`the API was asked ${productAsked} times for one product`);
  }
  busy = true;
  await checkPage('/', 200);
  await checkPage('/shop?q=asked+while+busy', 503);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => api.close(resolve));
}

if (problems.length > 0) {
  for (const args of logged) {
    process.stderr.write(`${args.map(String).join(' ')}\n`);
  }
  process.stderr.write(
    `The built website is not safe to serve:\n- ${problems.join('\n- ')}\n`,
  );
  process.exit(1);
}
console.log(
  'Built website checked: a policy with a fresh nonce on every page, every inline script carrying it, no inline style, no source maps, the fonts preloaded as the stylesheet names them, Brotli for files, pages and data.',
);
