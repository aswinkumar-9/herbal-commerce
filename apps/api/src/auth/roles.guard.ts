import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from './auth-user';
import { SUPER_USER_ONLY } from './super-user-only.decorator';

// Runs after the access-token guard, which has checked who is calling and
// attached their current role. Routes marked @SuperUserOnly() refuse everyone
// else with 403: the caller is already known, so this reveals nothing.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // On the handler or on its whole controller.
    const superUserOnly = this.reflector.getAllAndOverride<
      boolean | undefined
    >(SUPER_USER_ONLY, [context.getHandler(), context.getClass()]);
    if (!superUserOnly) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    // Fails closed: without a checked caller (a @Public() handler, or a guard
    // order mistake), a Super-User-only route is refused too.
    if (user?.role !== 'SUPER_USER') {
      throw new ForbiddenException('Only a Super User may do this.');
    }
    return true;
  }
}
