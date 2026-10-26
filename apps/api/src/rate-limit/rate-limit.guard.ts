import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { clientIpKey } from './client-ip';
import { RATE_LIMIT } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';
import type { RateLimitName } from './rate-limits';

// Runs before every route, even before the access-token check, so floods are
// refused cheaply. Every route counts against the baseline; a route can add
// its own limits with @RateLimit().
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ip = clientIpKey(context.switchToHttp().getRequest<Request>());
    const own =
      this.reflector.get<RateLimitName[] | undefined>(
        RATE_LIMIT,
        context.getHandler(),
      ) ?? [];
    const names: RateLimitName[] = ['baseline', ...own];
    // One after the other: once a limit refuses, the rest are not counted.
    for (const name of names) {
      await this.limits.consume(name, ip);
    }
    return true;
  }
}
