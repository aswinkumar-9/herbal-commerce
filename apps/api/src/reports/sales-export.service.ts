import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SalesReportQuery } from './reports.schemas';
import { MAX_REGISTER_LINES, SalesReportService } from './sales-report.service';
import { salesFileName, salesWorkbook } from './sales-workbook';

export const TOO_MANY_LINES = `More than ${MAX_REGISTER_LINES.toLocaleString('en-IN')} lines were sold or refunded in this period: download a shorter one`;

// The sales report as an Excel file, for Super Users (part 15D, ADR 0047).
// Each download is written to the audit log: the file holds the shop's
// takings, so who took a copy, of what, is kept.
@Injectable()
export class SalesExportService {
  constructor(
    private readonly reports: SalesReportService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async salesWorkbook(
    query: SalesReportQuery,
    context: AuditContext,
    now: Date = new Date(),
  ): Promise<{ fileName: string; file: Buffer }> {
    const data = await this.reports.forExport(query);
    if (!data) {
      throw new BadRequestException(TOO_MANY_LINES);
    }
    const preparer = context.actorId
      ? await this.prisma.user.findUnique({
          where: { id: context.actorId },
          select: { fullName: true },
        })
      : null;
    const file = await salesWorkbook({
      ...data,
      preparedAt: now,
      preparedBy: preparer?.fullName ?? 'a Super User',
    });
    const { from, to, productId, categoryId, brandId } = query;
    await this.audit.record(this.prisma, {
      ...context,
      action: 'report.sales_exported',
      targetType: 'report',
      after: {
        from,
        to,
        ...(productId ? { productId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(brandId ? { brandId } : {}),
        registerLines: data.register.length,
      },
    });
    return { fileName: salesFileName(data.report), file };
  }
}
