import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { Env } from '../config/env';
import { resolveRequestId } from './request-id';

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
        ],
        censor: '[REDACTED]',
      },
      // Health probes run often and would drown out useful logs.
      autoLogging: {
        ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false,
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
