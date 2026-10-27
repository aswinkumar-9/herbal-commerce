import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

// Deletes data past its retention period (ADR 0011).
@Module({
  providers: [RetentionService],
})
export class RetentionModule {}
