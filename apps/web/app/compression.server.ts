import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';
import type { BrotliCompress, Gzip } from 'node:zlib';
import { createReadableStreamFromReadable } from '@react-router/node';

// Compression for what the website sends (part 14B, after the Lighthouse
// audit): Brotli, or gzip for a client without it, with Node's own zlib.
// The built files are compressed once, at Brotli's best, when the website
// is built (scripts/precompress.ts); pages and their data as they are sent,
// at a quicker level. No secret ever shares a compressed answer with words
// a visitor chose (the session stays in its cookie, each page's nonce is
// new), so compression gives nothing away (BREACH).
export type Encoding = 'br' | 'gzip';

// The best coding the browser takes, from its Accept-Encoding: Brotli
// before gzip at an equal weight; none (the plain bytes) for neither.
export function chooseEncoding(
  accepted: string | null | undefined,
): Encoding | null {
  if (!accepted) {
    return null;
  }
  const weights = new Map<string, number>();
  for (const part of accepted.toLowerCase().split(',')) {
    const [name = '', ...params] = part.split(';').map((bit) => bit.trim());
    const q = params.find((param) => param.startsWith('q='));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    weights.set(name, Number.isFinite(weight) ? weight : 0);
  }
  const weightOf = (name: Encoding): number =>
    weights.get(name) ?? weights.get('*') ?? 0;
  const br = weightOf('br');
  const gzip = weightOf('gzip');
  if (br > 0 && br >= gzip) {
    return 'br';
  }
  return gzip > 0 ? 'gzip' : null;
}

// Answers differ by the coding asked for: a cache in between (a CDN) must
// keep them apart.
export function varyByEncoding(headers: Headers): void {
  const vary = headers.get('Vary');
  if (!vary) {
    headers.set('Vary', 'Accept-Encoding');
  } else if (!/\baccept-encoding\b/i.test(vary)) {
    headers.set('Vary', `${vary}, Accept-Encoding`);
  }
}

// An encoder for an answer made now. Quality 5 of Brotli's 11: nearly as
// small for a page, and quick enough for every request. React asks it to
// pass on what it has at each natural break (it calls flush()); the data
// a page asks for may come in parts, so each part is passed on at once.
export function liveEncoder(
  encoding: Encoding,
  { flushEachWrite = false }: { flushEachWrite?: boolean } = {},
): BrotliCompress | Gzip {
  if (encoding === 'br') {
    return createBrotliCompress({
      ...(flushEachWrite ? { flush: constants.BROTLI_OPERATION_FLUSH } : {}),
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      },
    });
  }
  return createGzip({
    level: 6,
    ...(flushEachWrite ? { flush: constants.Z_SYNC_FLUSH } : {}),
  });
}

// A finished Response, compressed for the browser that asked: the data a
// page asks for as the customer moves on. Left as it is when the browser
// takes neither coding, when it has no body, or is encoded already.
export function compressResponse(
  response: Response,
  encoding: Encoding | null,
): Response {
  varyByEncoding(response.headers);
  if (!encoding || !response.body || response.headers.has('Content-Encoding')) {
    return response;
  }
  const encoder = liveEncoder(encoding, { flushEachWrite: true });
  Readable.fromWeb(response.body as NodeReadableStream)
    .on('error', (error) => encoder.destroy(error))
    .pipe(encoder);
  const headers = new Headers(response.headers);
  headers.set('Content-Encoding', encoding);
  headers.delete('Content-Length');
  return new Response(createReadableStreamFromReadable(encoder), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
