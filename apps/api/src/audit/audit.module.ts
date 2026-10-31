import { Global, Module } from '@nestjs/common';
import { AuditReaderService } from './audit-reader.service';
import { AuditService } from './audit.service';

// Global: every module that changes data on behalf of staff writes here.
// Reading is for the Super Users' view of the log (ADR 0017).
@Global()
@Module({
  providers: [AuditService, AuditReaderService],
  exports: [AuditService, AuditReaderService],
})
export class AuditModule {}
