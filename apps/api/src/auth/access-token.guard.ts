import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AccessTokenService } from './access-token.service';
import type { AuthUser } from './auth-user';
import { IS_PUBLIC } from './public.decorator';
import { SessionService } from './session.service';

const INVALID_ACCESS_TOKEN = 'Invalid or expired access token';

// Reads "Authorization: Bearer <token>".
function bearerToken(header: string | undefined): string | undefined {
  const [scheme, token, ...rest] = header?.split(' ') ?? [];
  const isBearer = scheme?.toLowerCase() === 'bearer';
  return isBearer && token && rest.length === 0 ? token : undefined;
}

// Runs before every route. A route is protected unless its handler is @Public().
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

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthUser }>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let user: AuthUser;
    try {
      user = await this.accessTokens.verify(token);
    } catch {
      throw new UnauthorizedException(INVALID_ACCESS_TOKEN);
    }
    // The signature alone is not enough: the session must still be live.
    if (!(await this.sessions.isActive(user.id, user.sessionId))) {
      throw new UnauthorizedException(INVALID_ACCESS_TOKEN);
    }

    request.user = user;
    // Responses for a signed-in user are personal: never keep them in a cache.
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    return true;
  }
}
