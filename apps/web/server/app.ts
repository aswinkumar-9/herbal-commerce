// The website server (ADR 0039): Express, in front of React Router, which
// makes each page. It sends the security headers with every answer, tells
// the page code the customer's IP, serves the built files, and answers a
// failure with a plain message, never a stack trace.
import { join } from 'node:path';
import { createRequestHandler } from '@react-router/express';
import express from 'express';
import type {
  ErrorRequestHandler,
  Express,
  RequestHandler,
  Response,
} from 'express';
import type { ServerBuild } from 'react-router';
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
      express.static(clientDir, {
        maxAge: '1h',
        index: false,
        redirect: false,
        setHeaders: filePolicy,
      }),
    );
  }
  app.use(
    createRequestHandler({
      build,
      mode: config.production ? 'production' : 'development',
    }),
  );
  app.use(lastResort);
  return app;
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
  response
    .status(status)
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
