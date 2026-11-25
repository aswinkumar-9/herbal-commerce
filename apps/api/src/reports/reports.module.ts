import { Module } from '@nestjs/common';
import { SalesSummariesScheduler } from './sales-summaries.scheduler';
import { SalesSummariesService } from './sales-summaries.service';

// The reports for Super Users (part 15, ADR 0046): for now, the daily sales
// summaries they are read from, rebuilt every 5 minutes.
@Module({
  providers: [SalesSummariesService, SalesSummariesScheduler],
})
export class ReportsModule {}
