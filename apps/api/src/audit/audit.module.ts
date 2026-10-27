import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Global: every module that changes data on behalf of staff writes here.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
