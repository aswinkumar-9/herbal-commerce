import { Module } from '@nestjs/common';
import { CustomersReportService } from './customers-report.service';
import { OrdersReportService } from './orders-report.service';
import { SalesExportService } from './sales-export.service';
import { SalesReportService } from './sales-report.service';
import { SalesSummariesScheduler } from './sales-summaries.scheduler';
import { SalesSummariesService } from './sales-summaries.service';
import { StaffReportsController } from './staff-reports.controller';

// The reports for Super Users (part 15): the daily sales summaries,
// rebuilt every 5 minutes (ADR 0046), and the sales report read from them,
// on the page or as an Excel file (ADR 0047), and since part 15E the
// customers and the orders of a period.
@Module({
  controllers: [StaffReportsController],
  providers: [
    SalesSummariesService,
    SalesSummariesScheduler,
    SalesReportService,
    SalesExportService,
    CustomersReportService,
    OrdersReportService,
  ],
})
export class ReportsModule {}
