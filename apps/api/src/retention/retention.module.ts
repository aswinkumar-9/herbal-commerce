import { Module } from '@nestjs/common';
import { RetentionScheduler } from './retention.scheduler';
import { RetentionService } from './retention.service';

// Deletes data past its retention period (ADR 0011), once an hour.
@Module({
  providers: [RetentionService, RetentionScheduler],
})
export class RetentionModule {}
