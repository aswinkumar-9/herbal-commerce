import { SetMetadata } from '@nestjs/common';
import type { RateLimitName } from './rate-limits';

export const RATE_LIMIT = 'rateLimit';

// Per-IP limits for one route handler, counted on top of the baseline that
// every route has. Limits per email are counted in the services instead.
export const RateLimit = (...names: RateLimitName[]) =>
  SetMetadata(RATE_LIMIT, names);
