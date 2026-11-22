// Makes each page on the server (ADR 0039), as React Router's own does,
// with the page's security policy: a new nonce for every page, carried by
// the page's own inline scripts (React Router's start-up data) and by
// nothing else.
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { Readable, Writable } from 'node:stream';
import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import { renderToPipeableStream } from 'react-dom/server';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { ServerRouter } from 'react-router';
import type {
  EntryContext,
  HandleDataRequestFunction,
  HandleErrorFunction,
} from 'react-router';
import {
  chooseEncoding,
  compressResponse,
  liveEncoder,
  varyByEncoding,
} from './compression.server.ts';
import { getConfig } from './config.server.ts';
import { NonceContext } from './nonce.ts';
import { FILE_POLICY, documentPolicy } from './security-headers.ts';

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const nonce = randomBytes(16).toString('base64');
  // On a laptop, Vite's own inline scripts and styles make changes show at
  // once, so the policy is left out there; `pnpm web:start` and
  // `pnpm web:build` check the built website under it.
  if (!import.meta.env.DEV) {
    responseHeaders.set(
      'Content-Security-Policy',
      documentPolicy({ nonce, mediaBaseUrl: getConfig().mediaBaseUrl }),
    );
  }
  // The page carries its own nonce, so no shared cache may keep it.
  responseHeaders.set('Cache-Control', 'private, no-cache');
  // Sent with Brotli (or gzip) when the browser takes it.
  const encoding = chooseEncoding(request.headers.get('accept-encoding'));
  varyByEncoding(responseHeaders);

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get('user-agent');

    // Search engines and link previews get the whole page at once.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? 'onAllReady'
        : 'onShellReady';

    // Stop after the stream's time, so slow parts end as failed, not hung.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <NonceContext value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext>,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const finished = (): void => {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          };
          // React writes straight into the encoder and calls its flush() at
          // each natural break, so what is ready goes out compressed.
          let body: Readable & Writable;
          if (encoding) {
            body = liveEncoder(encoding).on('finish', finished);
            responseHeaders.set('Content-Encoding', encoding);
          } else {
            body = new PassThrough({
              final(callback) {
                finished();
                callback();
              },
            });
          }
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
          pipe(body);
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Failures after the page has started are logged here; earlier
          // ones are logged by React Router.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
  });
}

const KEPT_AHEAD = 'private, max-age=10';
const fetchedAhead = (request: Request): boolean =>
  /\bprefetch\b/i.test(request.headers.get('sec-purpose') ?? '');

// The data a page asks for as the customer moves on: nothing in it may run
// if it is ever opened on its own. Like the page itself, no shared cache
// may keep it: a CDN in front of the website would otherwise hand one
// visitor's answer, with its prices, stock and menu, to the next. A
// signed-in customer's data and a link's token page are no-store already
// (the middleware has run by now), and stay so.
// A page fetched ahead, while its link is pointed at (the browser says
// Sec-Purpose: prefetch), may be kept by the browser for 10 seconds, so
// the click that follows uses it instead of asking again; only a page as
// it is (200), never a redirect or a failure. Every answer varies by the
// cookie, so one kept before signing in is never used after.
// It goes out with Brotli (or gzip) too, when the browser takes it.
export const handleDataRequest: HandleDataRequestFunction = (
  response,
  { request },
) => {
  response.headers.set('Content-Security-Policy', FILE_POLICY);
  if (!response.headers.has('Cache-Control')) {
    response.headers.set(
      'Cache-Control',
      response.status === 200 && fetchedAhead(request)
        ? KEPT_AHEAD
        : 'private, no-cache',
    );
  }
  response.headers.append('Vary', 'Cookie');
  return compressResponse(
    response,
    chooseEncoding(request.headers.get('accept-encoding')),
  );
};

// A visitor leaving mid-page is not a failure.
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (!request.signal.aborted) {
    console.error(error);
  }
};
