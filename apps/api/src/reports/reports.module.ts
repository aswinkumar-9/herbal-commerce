import { Module } from '@nestjs/common';
import { SalesReportService } from './sales-report.service';
import { SalesSummariesScheduler } from './sales-summaries.scheduler';
import { SalesSummariesService } from './sales-summaries.service';
import { StaffReportsController } from './staff-reports.controller';

// The reports for Super Users (part 15): the daily sales summaries,
// rebuilt every 5 minutes (ADR 0046), and the sales report read from them
// (ADR 0047).
@Module({
  controllers: [StaffReportsController],
  providers: [
    SalesSummariesService,
    SalesSummariesScheduler,
    SalesReportService,
  ],
})
export class ReportsModule {}
