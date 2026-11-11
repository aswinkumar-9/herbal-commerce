import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { Env } from '../config/env';
import { resolveRequestId } from './request-id';

// What a customer searches for may tell of their health, so the search
// words are never logged (ADR 0030): "?q=piles&page=2" is logged as
// "?q=[REDACTED]&page=2".
export function withoutSearchWords(url: string): string {
  return url.replace(/([?&]q=)[^&#]*/g, '$1[REDACTED]');
}

export function buildLoggerParams(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
): Params {
  const isDev = env.NODE_ENV === 'development';

  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service: 'herbal-api', env: env.NODE_ENV },
      timestamp: stdTimeFunctions.isoTime,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id = resolveRequestId(req.headers['x-request-id']);
        res.setHeader('X-Request-Id', id);
        return id;
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
          'req.query.q',
        ],
        censor: '[REDACTED]',
      },
      serializers: {
        req: (req: { url?: string }) => {
          if (req.url) {
            req.url = withoutSearchWords(req.url);
          }
          return req;
        },
      },
      // Health probes run often and would drown out useful logs.
      autoLogging: {
        ignore: (req: IncomingMessage) =>
          req.url?.startsWith('/health') ?? false,
      },
      ...(isDev
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, colorize: true },
            },
          }
        : {
            formatters: { level: (label: string) => ({ level: label }) },
          }),
    },
  };
}
