import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { salesReportQuerySchema } from './reports.schemas';
import type { SalesReportQuery } from './reports.schemas';
import { SalesExportService } from './sales-export.service';
import { SalesReportService } from './sales-report.service';
import { XLSX_TYPE } from './sales-workbook';

// The reports, for Super Users only (part 15, ADR 0047): Admins never see
// the shop's takings. A Super User route takes staff tokens only. Reading is
// not audited; a download is, as a file can be passed on.
@SuperUserOnly()
@Controller('staff/reports')
export class StaffReportsController {
  constructor(
    private readonly reports: SalesReportService,
    private readonly exports: SalesExportService,
  ) {}

  // A period's sales, compared with the period before of the same length.
  @Get('sales')
  sales(
    @Query(new ZodValidationPipe(salesReportQuerySchema))
    query: SalesReportQuery,
  ) {
    return this.reports.sales(query);
  }

  // The same as an Excel file, with every day, every grouping and the
  // register of each line sold or refunded. Never kept by a browser or a
  // proxy on the way.
  @Get('sales/export')
  @Header('Cache-Control', 'no-store')
  async exportSales(
    @Query(new ZodValidationPipe(salesReportQuerySchema))
    query: SalesReportQuery,
    @CurrentAuditContext() context: AuditContext,
  ): Promise<StreamableFile> {
    const { fileName, file } = await this.exports.salesWorkbook(query, context);
    return new StreamableFile(file, {
      type: XLSX_TYPE,
      disposition: `attachment; filename="${fileName}"`,
      length: file.length,
    });
  }
}
