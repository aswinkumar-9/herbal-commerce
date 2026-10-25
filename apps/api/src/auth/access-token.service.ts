import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { Env } from '../config/env';
import type { AuthUser } from './auth-user';

// Short-lived on purpose: the refresh token is used to get a new one.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = 'herbal-api';
// Customer tokens only. Staff tokens will get their own audience.
const AUDIENCE = 'customer';

// Our own claims; jsonwebtoken checks the standard ones (exp, iss, aud...).
const claimsSchema = z.object({ sub: z.uuid(), sid: z.uuid() });

@Injectable()
export class AccessTokenService {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  // No email, name or role in the token: anyone holding it can read it.
  sign(user: AuthUser): Promise<string> {
    return this.jwt.signAsync(
      { sid: user.sessionId },
      {
        secret: this.secret,
        algorithm: 'HS256',
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        issuer: ISSUER,
        audience: AUDIENCE,
        subject: user.id,
      },
    );
  }

  // Throws if the token is forged, expired or not our customer access token.
  async verify(token: string): Promise<AuthUser> {
    const payload: unknown = await this.jwt.verifyAsync(token, {
      secret: this.secret,
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      maxAge: ACCESS_TOKEN_TTL_SECONDS,
    });
    const claims = claimsSchema.parse(payload);
    return { id: claims.sub, sessionId: claims.sid };
  }
}
