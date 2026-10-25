import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth-user';

// The caller the access-token guard verified. Only for protected routes.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user) {
      // A programming error: @CurrentUser() on a @Public() route.
      throw new Error('CurrentUser is only available on protected routes');
    }
    return user;
  },
);
