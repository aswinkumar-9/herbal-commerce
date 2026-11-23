// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { request as ask } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  brotliCompressSync,
  brotliDecompressSync,
  gunzipSync,
  gzipSync,
} from 'node:zlib';
import type { ServerBuild } from 'react-router';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { loadConfig } from '../app/config.server.ts';
import { CLIENT_IP_HEADER } from '../app/security-headers.ts';
import { createWebsite } from './app.ts';

// React Router's handler, standing in: it says which IP the page code was
// told, and passes a failure to load the build on, as the real one does.
vi.mock('@react-router/express', () => ({
  createRequestHandler:
    ({ build }: { build: () => Promise<ServerBuild> }) =>
    async (
      request: { headers: Record<string, string | undefined> },
      response: { type: (t: string) => { send: (b: string) => void } },
      next: (error: unknown) => void,
    ) => {
      try {
        await build();
      } catch (error) {
        next(error);
        return;
      }
      response
        .type('text/plain')
        .send(`ip=${request.headers[CLIENT_IP_HEADER] ?? 'none'}`);
    },
}));
const fakeBuild = (): ServerBuild => ({}) as ServerBuild;

let clientDir: string;
let server: Server;
let base: string;

async function start(
  env: Record<string, string> = {},
  build?: () => Promise<ServerBuild>,
) {
  const website = createWebsite({
    config: loadConfig(env),
    build: build ?? (async () => fakeBuild()),
    clientDir,
  });
  server = await new Promise<Server>((resolve) => {
    const listening = website.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

const SCRIPT = `export const words = ${JSON.stringify('Tulsi '.repeat(500))};`;

beforeAll(() => {
  clientDir = mkdtempSync(join(tmpdir(), 'herbal-web-'));
  mkdirSync(join(clientDir, 'assets'));
  writeFileSync(join(clientDir, 'assets', 'entry-abc123.js'), 'export {};');
  // A built file with the copies scripts/precompress.ts makes.
  writeFileSync(join(clientDir, 'assets', 'words-def456.js'), SCRIPT);
  writeFileSync(
    join(clientDir, 'assets', 'words-def456.js.br'),
    brotliCompressSync(SCRIPT),
  );
  writeFileSync(
    join(clientDir, 'assets', 'words-def456.js.gz'),
    gzipSync(SCRIPT),
  );
  writeFileSync(
    join(clientDir, 'favicon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
});
afterAll(() => {
  rmSync(clientDir, { recursive: true, force: true });
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('the website server', () => {
  it('sends the security headers with every answer, and no X-Powered-By', async () => {
    await start();
    for (const path of [
      '/favicon.svg',
      '/assets/entry-abc123.js',
      '/assets/missing.js',
    ]) {
      const response = await fetch(`${base}${path}`);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('referrer-policy')).toBe('same-origin');
      expect(response.headers.get('cross-origin-opener-policy')).toBe(
        'same-origin',
      );
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(response.headers.has('x-powered-by')).toBe(false);
    }
  });

  it('serves a built file for a year, as its name changes with its content, and lets nothing run in it', async () => {
    await start();
    const response = await fetch(`${base}/assets/entry-abc123.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it('answers a missing built file with a plain 404, never a page, that no cache keeps', async () => {
    await start();
    const response = await fetch(`${base}/assets/missing.js`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/plain');
    // A CDN keeping it would break a new release for everyone a while.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('Not found');
  });

  it('sends a built file’s Brotli copy to a browser that takes it, its gzip copy to one that takes only that, and the file itself otherwise', async () => {
    await start();
    // Node's own request, so the bytes arrive as they were sent.
    const get = (acceptEncoding: string) =>
      new Promise<{ headers: Record<string, unknown>; body: Buffer }>(
        (resolve, reject) => {
          ask(
            `${base}/assets/words-def456.js`,
            { headers: { 'accept-encoding': acceptEncoding } },
            (response) => {
              const parts: Buffer[] = [];
              response.on('data', (part: Buffer) => parts.push(part));
              response.on('end', () =>
                resolve({
                  headers: response.headers,
                  body: Buffer.concat(parts),
                }),
              );
            },
          )
            .on('error', reject)
            .end();
        },
      );

    const br = await get('gzip, deflate, br, zstd');
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(br.headers['vary']).toBe('Accept-Encoding');
    expect(br.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(brotliDecompressSync(br.body).toString()).toBe(SCRIPT);

    const gzip = await get('gzip');
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gzip.body).toString()).toBe(SCRIPT);

    const plain = await get('identity');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers['content-type']).toBe(br.headers['content-type']);
    expect(plain.headers['vary']).toBe('Accept-Encoding');
    expect(plain.body.toString()).toBe(SCRIPT);
  });

  it('leaves a file without copies as it is', async () => {
    await start();
    const small = await fetch(`${base}/assets/entry-abc123.js`, {
      headers: { 'accept-encoding': 'br' },
    });
    expect(small.headers.has('content-encoding')).toBe(false);
    expect(small.headers.has('vary')).toBe(false);
    expect(await small.text()).toBe('export {};');
  });

  it('serves the other public files for an hour', async () => {
    await start();
    const response = await fetch(`${base}/favicon.svg`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('tells the page code the IP it saw, never one a visitor sent', async () => {
    await start();
    const response = await fetch(`${base}/`, {
      headers: { [CLIENT_IP_HEADER]: '6.6.6.6' },
    });
    expect(await response.text()).toBe('ip=127.0.0.1');
  });

  it('takes the customer’s IP from a proxy only when the settings trust it', async () => {
    await start();
    const untrusted = await fetch(`${base}/`, {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(await untrusted.text()).toBe('ip=127.0.0.1');
    await new Promise((resolve) => server.close(resolve));

    await start({ WEB_TRUST_PROXY: 'loopback' });
    const trusted = await fetch(`${base}/`, {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(await trusted.text()).toBe('ip=203.0.113.7');
  });

  it('lets search engines in only when the settings say so', async () => {
    await start({ WEB_INDEXING: 'on' });
    expect(
      (await fetch(`${base}/favicon.svg`)).headers.has('x-robots-tag'),
    ).toBe(false);
  });

  it('refuses a form sent from another site, before any page sees it (ADR 0041)', async () => {
    await start({ WEB_ORIGIN: 'http://localhost:3001' });
    const send = (method: string, headers: Record<string, string>) =>
      fetch(`${base}/sign-in`, {
        method,
        headers,
        body: method === 'GET' ? undefined : 'x',
      });

    for (const [method, headers, status] of [
      ['POST', { origin: 'http://localhost:3001' }, 200],
      ['POST', { origin: 'https://evil.example' }, 403],
      ['POST', { origin: 'null' }, 403],
      ['POST', { origin: 'http://localhost:3001.evil.example' }, 403],
      ['DELETE', { origin: 'https://evil.example' }, 403],
      // No Origin: a browser says where the form came from another way.
      ['POST', { 'sec-fetch-site': 'cross-site' }, 403],
      ['POST', { 'sec-fetch-site': 'same-site' }, 403],
      ['POST', { 'sec-fetch-site': 'same-origin' }, 200],
      // Neither: no browser, so no customer's cookie to borrow.
      ['POST', {}, 200],
      // Reading a page is never refused.
      ['GET', { origin: 'https://evil.example' }, 200],
    ] as const) {
      const response = await send(method, headers);
      expect([method, JSON.stringify(headers), response.status]).toEqual([
        method,
        JSON.stringify(headers),
        status,
      ]);
      if (status === 403) {
        expect(await response.text()).toBe(
          'This form can only be sent from the shop’s own pages.',
        );
      }
    }
  });

  describe('Razorpay’s answer, as it sends the customer back (ADR 0042)', () => {
    const ORDER = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
    const PAYMENT = 'pay_G3P9vcIhRs3NV4';
    const SIGNATURE = 'ab'.repeat(32);
    const fromRazorpay = (
      body: BodyInit | null,
      {
        path = `/orders/${ORDER}/payment`,
        type,
      }: { path?: string; type?: string } = {},
    ) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          origin: 'https://api.razorpay.com',
          'sec-fetch-site': 'cross-site',
          ...(type ? { 'content-type': type } : {}),
        },
        body,
      });

    it('takes it from Razorpay’s site, and sends the customer on to confirm it, changing nothing', async () => {
      await start({ WEB_ORIGIN: 'http://localhost:3001' });
      const response = await fromRazorpay(
        new URLSearchParams({
          razorpay_payment_id: PAYMENT,
          razorpay_order_id: 'order_RB58MiP5SPFYyM',
          razorpay_signature: SIGNATURE,
        }),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        `/orders/${ORDER}/payment?payment=${PAYMENT}&signature=${SIGNATURE}`,
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('reads it sent as multipart form data too', async () => {
      await start({ WEB_ORIGIN: 'http://localhost:3001' });
      const form = new FormData();
      form.set('razorpay_payment_id', PAYMENT);
      form.set('razorpay_signature', SIGNATURE);
      const response = await fromRazorpay(form);
      expect(response.headers.get('location')).toBe(
        `/orders/${ORDER}/payment?payment=${PAYMENT}&signature=${SIGNATURE}`,
      );
    });

    it('sends anything but a payment’s ID and signature to the order, as a payment that did not go through', async () => {
      await start({ WEB_ORIGIN: 'http://localhost:3001' });
      for (const [body, type] of [
        [
          new URLSearchParams({
            'error[code]': 'BAD_REQUEST_ERROR',
            'error[description]': 'Payment failed',
          }),
          undefined,
        ],
        [new URLSearchParams({ razorpay_payment_id: PAYMENT }), undefined],
        [
          new URLSearchParams({
            razorpay_payment_id: 'pay_x/../../evil',
            razorpay_signature: SIGNATURE,
          }),
          undefined,
        ],
        [
          new URLSearchParams({
            razorpay_payment_id: PAYMENT,
            razorpay_signature: 'zz'.repeat(32),
          }),
          undefined,
        ],
        [
          `{"razorpay_payment_id":"${PAYMENT}","razorpay_signature":"${SIGNATURE}"}`,
          'application/json',
        ],
        [null, undefined],
      ] as const) {
        const response = await fromRazorpay(body, type ? { type } : {});
        expect([
          String(body),
          response.status,
          response.headers.get('location'),
        ]).toEqual([String(body), 303, `/orders/${ORDER}?payment=failed`]);
      }
    });

    it('takes it for an order’s address only; every other form from another site is still refused', async () => {
      await start({ WEB_ORIGIN: 'http://localhost:3001' });
      const form = new URLSearchParams({
        razorpay_payment_id: PAYMENT,
        razorpay_signature: SIGNATURE,
      });
      const notAnOrder = await fromRazorpay(form, {
        path: '/orders/7/payment',
      });
      expect(notAnOrder.status).toBe(404);
      for (const path of [
        `/orders/${ORDER}`,
        '/checkout',
        `/orders/${ORDER}/payment/x`,
      ]) {
        const response = await fromRazorpay(form, { path });
        expect([path, response.status]).toEqual([path, 403]);
      }
      // Reading the page it leads to is the page code's.
      const page = await fetch(
        `${base}/orders/${ORDER}/payment?payment=${PAYMENT}`,
      );
      expect(await page.text()).toMatch(/^ip=/);
    });

    it('refuses a form far bigger than Razorpay’s', async () => {
      await start({ WEB_ORIGIN: 'http://localhost:3001' });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = await fromRazorpay(
        new URLSearchParams({
          razorpay_payment_id: PAYMENT,
          padding: 'x'.repeat(20_000),
        }),
      );
      expect(response.status).toBe(413);
      expect(response.headers.get('location')).toBeNull();
    });
  });

  it('answers a failure with a plain message, never its details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start({}, async () => {
      throw new Error('secret detail');
    });
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('secret detail');
    expect(body).not.toContain('at ');
  });
});
