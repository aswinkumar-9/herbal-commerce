import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from './retry-later.exception';

// Errors raised by the body parser (malformed JSON, oversized body) carry a 4xx statusCode.
function isClientError(exception: unknown): exception is { statusCode: number } {
  if (typeof exception !== 'object' || exception === null) {
    return false;
  }
  const statusCode = (exception as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ id?: string | number }>();
    const response = http.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
      setHeader: (name: string, value: string) => void;
    }>();
    const requestId = request.id !== undefined ? String(request.id) : undefined;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const original = exception.getResponse();
      body =
        typeof original === 'string'
          ? { message: original }
          : { ...(original as Record<string, unknown>) };
    } else if (isClientError(exception)) {
      status = exception.statusCode;
      body = {
        message: status === 413 ? 'Request body too large' : 'Invalid request',
      };
    } else {
      // Details go to the log only, never to the client.
      this.logger.error({ err: exception }, 'Unhandled exception');
    }

    if (exception instanceof RetryLaterException) {
      // Tells the client how many seconds to wait before trying again.
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    response.status(status).json({ ...body, statusCode: status, requestId });
  }
}
