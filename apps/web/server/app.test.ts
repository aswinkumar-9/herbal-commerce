// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

beforeAll(() => {
  clientDir = mkdtempSync(join(tmpdir(), 'herbal-web-'));
  mkdirSync(join(clientDir, 'assets'));
  writeFileSync(join(clientDir, 'assets', 'entry-abc123.js'), 'export {};');
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

  it('answers a missing built file with a plain 404, never a page', async () => {
    await start();
    const response = await fetch(`${base}/assets/missing.js`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe('Not found');
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
