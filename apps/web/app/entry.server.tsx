// Makes each page on the server (ADR 0039), as React Router's own does,
// with the page's security policy: a new nonce for every page, carried by
// the page's own inline scripts (React Router's start-up data) and by
// nothing else.
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import { renderToPipeableStream } from 'react-dom/server';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { ServerRouter } from 'react-router';
import type { EntryContext, HandleErrorFunction } from 'react-router';
import { getConfig } from './config.server.ts';
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
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
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

// The data a page asks for as the customer moves on: nothing in it may run
// if it is ever opened on its own.
export function handleDataRequest(response: Response): Response {
  response.headers.set('Content-Security-Policy', FILE_POLICY);
  return response;
}

// A visitor leaving mid-page is not a failure.
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (!request.signal.aborted) {
    console.error(error);
  }
};
