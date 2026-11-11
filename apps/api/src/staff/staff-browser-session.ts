import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { INVALID_REFRESH_TOKEN, SESSION_TTL_MS } from '../auth/session.service';
import type { TokenPair } from '../auth/session.service';
import type { Env } from '../config/env';

// The staff refresh token, for the admin console only (ADR 0031). Only the
// staff sign-in routes ever receive it.
export const STAFF_REFRESH_COOKIE = 'herbal_staff_refresh';
export const STAFF_COOKIE_PATH = '/v1/staff/auth';

// What a staff sign-in answers the console: the access token, kept in its
// memory. The refresh token is in the cookie, out of every script's reach.
export type ConsoleTokens = Omit<TokenPair, 'refreshToken'>;

// The admin console's session in the browser (ADR 0031). A request from
// the console's own origin keeps its refresh token in a cookie that is
// HttpOnly, SameSite=Strict and, over https, Secure: page scripts never
// see it, and no other site can make the browser send it. Browsers always
// send Origin on a POST, so a script can't pass itself off as another
// client. Requests without the console's Origin, such as PowerShell or the
// smoke test, carry the token in the body as before.
@Injectable()
export class StaffBrowserSession {
  private readonly origin: string;
  private readonly secure: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.origin = config.get('ADMIN_ORIGIN', { infer: true });
    this.secure = this.origin.startsWith('https://');
  }

  // Whether the request comes from the admin console.
  fromConsole(origin: string | undefined): boolean {
    return origin === this.origin;
  }

  // Puts the refresh token in the cookie, and answers the rest.
  answer(tokens: TokenPair, response: Response): ConsoleTokens {
    const { refreshToken, ...rest } = tokens;
    this.setCookie(response, refreshToken, SESSION_TTL_MS.staff / 1000);
    return rest;
  }

  // The refresh token from the cookie, or 401 without one.
  token(cookieHeader: string | undefined): string {
    const token = readCookie(cookieHeader, STAFF_REFRESH_COOKIE);
    if (!token) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
    return token;
  }

  // The refresh token from the cookie, if any.
  tokenIfAny(cookieHeader: string | undefined): string | undefined {
    return readCookie(cookieHeader, STAFF_REFRESH_COOKIE);
  }

  // Tells the browser to forget the cookie.
  clear(response: Response): void {
    this.setCookie(response, '', 0);
  }

  private setCookie(response: Response, value: string, maxAge: number): void {
    response.setHeader(
      'Set-Cookie',
      [
        `${STAFF_REFRESH_COOKIE}=${value}`,
        `Path=${STAFF_COOKIE_PATH}`,
        `Max-Age=${maxAge}`,
        'HttpOnly',
        'SameSite=Strict',
        ...(this.secure ? ['Secure'] : []),
      ].join('; '),
    );
  }
}

// One cookie's value from a Cookie header: "a=1; b=2". A refresh token is
// base64url, so it needs no decoding; anything else is ignored.
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const pair of (header ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim() === name) {
      const value = pair.slice(at + 1).trim();
      return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}
