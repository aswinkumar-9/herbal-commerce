import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import type { RateLimitName } from '../rate-limit/rate-limits';
import { emailAndIpKey } from './login-limits';

// A failed-login limit and the key it counts.
type FailureCounter = [RateLimitName, string];

function failureCounters(email: string, ip: string): FailureCounter[] {
  return [
    // One person guessing one account's password.
    ['loginFailuresByEmailAndIp', emailAndIpKey(email, ip)],
    // Many machines guessing one account's password.
    ['loginFailuresByEmail', email],
    // One machine trying many accounts.
    ['loginFailuresByIp', ip],
  ];
}

// The failed-login counters. The customer and the staff login share them, so
// guessing on either path counts against the same limits.
@Injectable()
export class LoginAttemptsService {
  constructor(
    private readonly limits: RateLimitService,
    @InjectPinoLogger(LoginAttemptsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // While too many recent attempts failed, refuses with 429 before any
  // password work.
  async check(email: string, ip: string): Promise<void> {
    await Promise.all(
      failureCounters(email, ip).map(([name, key]) =>
        this.limits.check(name, key),
      ),
    );
  }

  // Counts a failed attempt against all three limits; the caller then answers
  // 401. The attempt that goes over a limit throws 429 instead. Unknown emails
  // count too, so a 429 never reveals whether an account exists.
  async failed(email: string, ip: string, userId?: string): Promise<void> {
    try {
      await Promise.all(
        failureCounters(email, ip).map(([name, key]) =>
          this.limits.consume(name, key),
        ),
      );
    } catch (error) {
      if (error instanceof RetryLaterException) {
        this.logger.warn(
          { userId },
          'Too many failed sign-ins: refusing for a while',
        );
      }
      throw error;
    }
  }

  // A successful sign-in: this person on this IP starts again from zero.
  // The per-email and per-IP counters keep counting.
  async succeeded(email: string, ip: string): Promise<void> {
    await this.limits.reset(
      'loginFailuresByEmailAndIp',
      emailAndIpKey(email, ip),
    );
  }
}
