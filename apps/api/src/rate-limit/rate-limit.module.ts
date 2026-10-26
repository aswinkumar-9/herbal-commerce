import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

// Global, so the guard and the login code share the same limits.
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
