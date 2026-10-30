import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { auditContextOf } from './audit-context';

// Who is acting, from which address, in which request (see auditContextOf).
export const CurrentAuditContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    auditContextOf(context.switchToHttp().getRequest()),
);
