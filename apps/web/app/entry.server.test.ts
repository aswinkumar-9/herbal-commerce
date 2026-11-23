// @vitest-environment node
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { RouterContextProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { handleDataRequest } from './entry.server.tsx';

type Args = Parameters<typeof handleDataRequest>[1];
const DATA = JSON.stringify({ products: Array(200).fill('Tulsi Drops') });

// `ahead`: fetched ahead by the browser, while a link is pointed at.
async function answerTo(
  acceptEncoding: string | null,
  headers: Record<string, string> = {},
  { status = 200, ahead = false }: { status?: number; ahead?: boolean } = {},
): Promise<Response> {
  const request = new Request('http://localhost/shop.data', {
    headers: {
      ...(acceptEncoding ? { 'accept-encoding': acceptEncoding } : {}),
      ...(ahead ? { 'sec-purpose': 'prefetch' } : {}),
    },
  });
  return handleDataRequest(new Response(DATA, { status, headers }), {
    request,
    params: {},
    context: new RouterContextProvider(),
  } as unknown as Args);
}

const bytes = async (response: Response): Promise<Buffer> =>
  Buffer.from(await response.arrayBuffer());

describe('the data a page asks for as the customer moves on', () => {
  it('is kept by no shared cache, such as a CDN, and nothing in it may run', async () => {
    const answer = await answerTo(null);
    expect(answer.headers.get('cache-control')).toBe('private, no-cache');
    expect(answer.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it('stays kept by no cache at all when it is a signed-in customer’s or a link’s', async () => {
    const answer = await answerTo(null, {
      'Cache-Control': 'private, no-store',
    });
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
    const ahead = await answerTo(
      null,
      { 'Cache-Control': 'private, no-store' },
      { ahead: true },
    );
    expect(ahead.headers.get('cache-control')).toBe('private, no-store');
  });

  it('fetched ahead while its link is pointed at, is kept 10 seconds for the click', async () => {
    const answer = await answerTo(null, {}, { ahead: true });
    expect(answer.headers.get('cache-control')).toBe('private, max-age=10');
  });

  it('fetched ahead, is never kept when it is a redirect or a failure', async () => {
    for (const status of [202, 404, 500, 503]) {
      const answer = await answerTo(null, {}, { status, ahead: true });
      expect(answer.headers.get('cache-control'), String(status)).toBe(
        'private, no-cache',
      );
    }
  });

  it('is told apart by the cookie, so one kept before signing in is not used after', async () => {
    const answer = await answerTo(null, {}, { ahead: true });
    expect(answer.headers.get('vary')).toBe('Cookie, Accept-Encoding');
  });

  it('goes out with Brotli when the browser takes it, and the same data comes back out', async () => {
    const answer = await answerTo('gzip, deflate, br, zstd');
    expect(answer.headers.get('content-encoding')).toBe('br');
    expect(answer.headers.get('vary')).toBe('Cookie, Accept-Encoding');
    const sent = await bytes(answer);
    expect(sent.length).toBeLessThan(DATA.length / 10);
    expect(brotliDecompressSync(sent).toString()).toBe(DATA);
  });

  it('falls back to gzip, and to the plain data for a browser that takes neither', async () => {
    const zipped = await answerTo('gzip');
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(await bytes(zipped)).toString()).toBe(DATA);

    const plain = await answerTo('identity');
    expect(plain.headers.has('content-encoding')).toBe(false);
    // Still marked, so a cache in between keeps the two apart.
    expect(plain.headers.get('vary')).toBe('Cookie, Accept-Encoding');
    expect(await plain.text()).toBe(DATA);
  });
});
