import { createHmac, hkdfSync } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible';
import { RetryLaterException } from '../common/retry-later.exception';
import { Env } from '../config/env';
import { ValkeyService } from '../valkey/valkey.service';
import { RATE_LIMITS, RateLimitName } from './rate-limits';

function tooManyRequests(result: RateLimiterRes): RetryLaterException {
  return new RetryLaterException(
    429,
    'Too many requests. Please try again later.',
    'RATE_LIMITED',
    Math.max(1, Math.ceil(result.msBeforeNext / 1000)),
  );
}

@Injectable()
export class RateLimitService {
  private readonly limiters: Record<RateLimitName, RateLimiterRedis>;
  // Keys are hashed with this, so Valkey never holds an email or an IP.
  private readonly keySecret: Buffer;

  constructor(valkey: ValkeyService, config: ConfigService<Env, true>) {
    // Derived from the JWT secret for this one job, so that secret itself
    // is never used for two different things.
    this.keySecret = Buffer.from(
      hkdfSync(
        'sha256',
        config.get('JWT_ACCESS_SECRET', { infer: true }),
        '',
        'rate-limit keys',
        32,
      ),
    );
    const entries = Object.entries(RATE_LIMITS).map(([name, limit]) => {
      const keyPrefix = `rl:${name}`;
      const limiter = new RateLimiterRedis({
        storeClient: valkey,
        keyPrefix,
        ...limit,
        // While Valkey is down, skip it at once and count in memory instead.
        rejectIfRedisNotReady: true,
        insuranceLimiter: new RateLimiterMemory({ keyPrefix, ...limit }),
      });
      return [name, limiter];
    });
    this.limiters = Object.fromEntries(entries) as Record<
      RateLimitName,
      RateLimiterRedis
    >;
  }

  // Counts one request (or failure) for this key. Throws 429 once the
  // limit is used up.
  async consume(name: RateLimitName, key: string): Promise<void> {
    try {
      await this.limiters[name].consume(this.hashKey(key));
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        throw tooManyRequests(error);
      }
      throw error;
    }
  }

  private hashKey(key: string): string {
    return createHmac('sha256', this.keySecret)
      .update(key)
      .digest('hex')
      .slice(0, 32);
  }
}
