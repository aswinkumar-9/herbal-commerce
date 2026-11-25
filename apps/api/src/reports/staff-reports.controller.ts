import { Controller, Get, Query } from '@nestjs/common';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { salesReportQuerySchema } from './reports.schemas';
import type { SalesReportQuery } from './reports.schemas';
import { SalesReportService } from './sales-report.service';

// The reports, for Super Users only (part 15, ADR 0047): Admins never see
// the shop's takings. A Super User route takes staff tokens only. Reading is
// not audited; exports will be (part 15F).
@SuperUserOnly()
@Controller('staff/reports')
export class StaffReportsController {
  constructor(private readonly reports: SalesReportService) {}

  // A period's sales, compared with the period before of the same length.
  @Get('sales')
  sales(
    @Query(new ZodValidationPipe(salesReportQuerySchema))
    query: SalesReportQuery,
  ) {
    return this.reports.sales(query);
  }
}
