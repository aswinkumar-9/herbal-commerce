import { Controller, Get, Query } from '@nestjs/common';
import { AuditReaderService } from '../audit/audit-reader.service';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { auditLogQuerySchema } from './staff.schemas';
import type { AuditLogQueryInput } from './staff.schemas';

// The audit log, for Super Users only (ADR 0004, ADR 0017). Newest first,
// one page at a time: the nextBefore of one page is the ?before= of the
// next.
@SuperUserOnly()
@Controller('staff/audit-log')
export class StaffAuditLogController {
  constructor(private readonly reader: AuditReaderService) {}

  // Reading changes nothing, so it is not audited itself.
  @Get()
  list(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQueryInput,
  ) {
    return this.reader.list(query);
  }
}
