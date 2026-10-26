import { HttpException } from '@nestjs/common';

// A refusal the client should retry later: 429 (too many requests) or
// 503 (server busy). The error filter sends retryAfterSeconds as Retry-After.
export class RetryLaterException extends HttpException {
  constructor(
    status: 429 | 503,
    message: string,
    code: string,
    readonly retryAfterSeconds: number,
  ) {
    super({ message, code }, status);
  }
}
