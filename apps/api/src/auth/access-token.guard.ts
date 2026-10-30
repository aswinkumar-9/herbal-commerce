import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AccessTokenService } from './access-token.service';
import type { Audience } from './access-token.service';
import type { AuthUser } from './auth-user';
import { IS_PUBLIC } from './public.decorator';
import { SessionService } from './session.service';
import { STAFF_ONLY } from './staff-only.decorator';

const INVALID_ACCESS_TOKEN = 'Invalid or expired access token';

// Reads "Authorization: Bearer <token>".
function bearerToken(header: string | undefined): string | undefined {
  const [scheme, token, ...rest] = header?.split(' ') ?? [];
  const isBearer = scheme?.toLowerCase() === 'bearer';
  return isBearer && token && rest.length === 0 ? token : undefined;
}

// Runs before every route. A route is protected unless its handler is @Public().
// Protected routes are for customers unless marked @StaffOnly(), and each one
// accepts only access tokens and sessions of its own audience.
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only single handlers can be public, never whole controllers.
    if (this.reflector.get<boolean>(IS_PUBLIC, context.getHandler())) {
      return true;
    }
    // On the handler or on its whole controller.
    const staffOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      STAFF_ONLY,
      [context.getHandler(), context.getClass()],
    );
    const audience: Audience = staffOnly ? 'staff' : 'customer';

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthUser }>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let user: AuthUser;
    try {
      // A token for the other audience fails here, like a forged one.
      user = await this.accessTokens.verify(token, audience);
    } catch {
      throw new UnauthorizedException(INVALID_ACCESS_TOKEN);
    }
    // The signature alone is not enough: the session must still be live.
    if (!(await this.sessions.isActive(user.id, user.sessionId, audience))) {
      throw new UnauthorizedException(INVALID_ACCESS_TOKEN);
    }

    request.user = user;
    // Responses for a signed-in user are personal: never keep them in a cache.
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    return true;
  }
}
