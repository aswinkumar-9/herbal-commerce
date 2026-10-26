import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { clientIpKey } from './client-ip';

// The caller's IP, exactly as the rate limits count it (see clientIpKey).
export const ClientIp = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    clientIpKey(context.switchToHttp().getRequest<Request>()),
);
