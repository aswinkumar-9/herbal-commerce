// The website server (ADR 0039): Express, in front of React Router, which
// makes each page. It sends the security headers with every answer, tells
// the page code the customer's IP, serves the built files, refuses forms
// sent from other sites (ADR 0041), and answers a failure with a plain
// message, never a stack trace.
import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { createRequestHandler } from '@react-router/express';
import express from 'express';
import type {
  ErrorRequestHandler,
  Express,
  RequestHandler,
  Response,
} from 'express';
import type { ServerBuild } from 'react-router';
import { chooseEncoding } from '../app/compression.server.ts';
import type { WebConfig } from '../app/config.server.ts';
import {
  CLIENT_IP_HEADER,
  FILE_POLICY,
  baseHeaders,
} from '../app/security-headers.ts';

export function createWebsite({
  config,
  build,
  clientDir,
  devMiddleware,
}: {
  config: WebConfig;
  build: ServerBuild | (() => Promise<ServerBuild>);
  // The built browser files (build/client), served as they are.
  clientDir?: string;
  // Vite, on a laptop.
  devMiddleware?: RequestHandler;
}): Express {
  const app = express();
  app.disable('x-powered-by');
  // Only proxies the settings name may report the customer's IP.
  app.set(
    'trust proxy',
    config.trustProxy.length > 0 ? config.trustProxy : false,
  );

  app.use(securityHeaders(config));
  app.use(clientIp);
  if (devMiddleware) {
    app.use(devMiddleware);
  }
  if (clientDir) {
    const filePolicy = (response: Response): void => {
      response.setHeader('Content-Security-Policy', FILE_POLICY);
    };
    // A built file's name holds its content's hash, so it never changes:
    // a browser may keep it for a year. A missing one is a plain 404.
    app.use(
      '/assets',
      precompressed(join(clientDir, 'assets')),
      express.static(join(clientDir, 'assets'), {
        immutable: true,
        maxAge: '1y',
        index: false,
        redirect: false,
        fallthrough: false,
        setHeaders: filePolicy,
      }),
    );
    app.use(
      precompressed(clientDir),
      express.static(clientDir, {
        maxAge: '1h',
        index: false,
        redirect: false,
        setHeaders: filePolicy,
      }),
    );
  }
  app.use(formsFromThisSite(config));
  app.use(
    createRequestHandler({
      build,
      mode: config.production ? 'production' : 'development',
    }),
  );
  app.use(lastResort);
  return app;
}

// The built files' Brotli and gzip copies, made once when the website is
// built (scripts/precompress.ts): a browser gets the smallest it can read,
// with the plain file's type and caching, and every answer for such a file
// says it varies by coding, for a CDN in between. Only the copies found at
// start are looked up, so a request's path never reaches the disk here.
export function precompressed(dir: string): RequestHandler {
  const copies = new Set(
    listFiles(dir)
      .filter((file) => /\.(br|gz)$/.test(file))
      .map((file) => `/${relative(dir, file).split(sep).join('/')}`),
  );
  return (request, response, next) => {
    const path = request.path;
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      (!copies.has(`${path}.br`) && !copies.has(`${path}.gz`))
    ) {
      next();
      return;
    }
    response.vary('Accept-Encoding');
    const encoding = chooseEncoding(request.headers['accept-encoding']);
    const copy = encoding && `${path}.${encoding === 'br' ? 'br' : 'gz'}`;
    if (copy && copies.has(copy)) {
      response.setHeader('Content-Encoding', encoding);
      response.type(extname(path));
      request.url = copy;
    }
    next();
  };
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
  } catch {
    // No built files (a laptop, before the first build).
    return [];
  }
}

// A form may only be sent from the website's own pages (ADR 0041): a
// request that changes something (anything but GET and HEAD) from a browser
// must come from the website's own address. Its cookie is SameSite=Lax too,
// so another site can't send it; this refuses such a request outright.
// Without Origin and Sec-Fetch-Site, the sender is no browser, and has no
// customer's cookie to borrow.
export function formsFromThisSite(config: WebConfig): RequestHandler {
  return (request, response, next) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      next();
      return;
    }
    const origin = request.get('origin');
    const site = request.get('sec-fetch-site');
    const fromHere = origin
      ? origin === config.origin
      : site === undefined || site === 'same-origin';
    if (fromHere) {
      next();
      return;
    }
    response
      .status(403)
      .type('text/plain')
      .send('This form can only be sent from the shop’s own pages.');
  };
}

export function securityHeaders(config: WebConfig): RequestHandler {
  const headers = baseHeaders({
    indexing: config.indexing,
    https: config.origin.startsWith('https://'),
  });
  return (_request, response, next) => {
    response.set(headers);
    next();
  };
}

// The customer's IP, as this server saw it (behind a trusted proxy, the one
// it reported), for the page code to pass on to the API. A copy sent by the
// visitor is thrown away first, so nobody can choose their own.
export const clientIp: RequestHandler = (request, _response, next) => {
  delete request.headers[CLIENT_IP_HEADER];
  if (request.ip) {
    request.headers[CLIENT_IP_HEADER] = request.ip;
  }
  next();
};

// Anything React Router didn't answer: a missing file, or a failure
// outside a page. Plain text; the details go to the server's log only.
export const lastResort: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  const status = statusOf(error);
  if (status >= 500) {
    console.error(error);
  }
  // Never kept by a cache: a file missing for a moment while a new release
  // reaches every server must not stay "not found" in a CDN.
  response
    .status(status)
    .set('Cache-Control', 'no-store')
    .type('text/plain')
    .send(status === 404 ? 'Not found' : 'Something went wrong');
};

function statusOf(error: unknown): number {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? error.status
      : undefined;
  return typeof status === 'number' && status >= 400 && status < 600
    ? status
    : 500;
}
