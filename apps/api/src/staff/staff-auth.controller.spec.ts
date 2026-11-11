import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AuditContext } from '../audit/audit-context';
import type { SessionService } from '../auth/session.service';
import type { Env } from '../config/env';
import type { AdminInvitationService } from './admin-invitation.service';
import { StaffAuthController } from './staff-auth.controller';
import type { StaffAuthService } from './staff-auth.service';
import { StaffBrowserSession } from './staff-browser-session';

const CONSOLE = 'http://localhost:5173';
const OLD = 'old_refresh_token_abcdefghijklmnopqrstuvwxy';
const NEW = 'new_refresh_token_abcdefghijklmnopqrstuvwxy';
const pair = (refreshToken: string) => ({
  accessToken: 'access.jwt.value',
  tokenType: 'Bearer' as const,
  expiresIn: 900,
  refreshToken,
});
const context: AuditContext = {
  ip: '203.0.113.7',
  requestId: 'request-1',
};
const login = {
  email: 'dev.one@example.com',
  password: 'correct horse battery staple',
  code: '123456',
};
const cookieOf = (token: string) => `theme=dark; herbal_staff_refresh=${token}`;

function setup() {
  const staffAuth = { login: jest.fn().mockResolvedValue(pair(NEW)) };
  const sessions = {
    refresh: jest.fn().mockResolvedValue(pair(NEW)),
    logout: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue(CONSOLE) };
  const response = { setHeader: jest.fn() };
  const controller = new StaffAuthController(
    staffAuth as unknown as StaffAuthService,
    sessions as unknown as SessionService,
    {} as AdminInvitationService,
    new StaffBrowserSession(config as unknown as ConfigService<Env, true>),
  );
  return {
    controller,
    staffAuth,
    sessions,
    response,
    res: response as unknown as Response,
    // The Set-Cookie values sent.
    cookies: () => response.setHeader.mock.calls.map(([, value]) => value),
  };
}

describe('StaffAuthController, from the admin console (ADR 0031)', () => {
  it('signs in: the access token in the answer, the refresh token only in the cookie', async () => {
    const { controller, staffAuth, res, cookies } = setup();

    await expect(
      controller.login(login, '203.0.113.7', context, CONSOLE, res),
    ).resolves.toStrictEqual({
      accessToken: 'access.jwt.value',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(staffAuth.login).toHaveBeenCalledWith(login, '203.0.113.7', context);
    expect(cookies()).toEqual([
      `herbal_staff_refresh=${NEW}; Path=/v1/staff/auth; Max-Age=43200; HttpOnly; SameSite=Strict`,
    ]);
  });

  it('sets no cookie when the sign-in fails', async () => {
    const { controller, staffAuth, res, cookies } = setup();
    staffAuth.login.mockRejectedValueOnce(
      new UnauthorizedException('Invalid email, password or code'),
    );

    await expect(
      controller.login(login, '203.0.113.7', context, CONSOLE, res),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(cookies()).toEqual([]);
  });

  it("refreshes with the cookie's token, never the body's, and sets the new one", async () => {
    const { controller, sessions, res, cookies } = setup();

    await expect(
      controller.refresh(
        { refreshToken: 'body_token_is_ignored_abcdefghijklmnop' },
        CONSOLE,
        cookieOf(OLD),
        res,
      ),
    ).resolves.toStrictEqual({
      accessToken: 'access.jwt.value',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(sessions.refresh).toHaveBeenCalledWith(OLD, 'staff');
    expect(cookies()).toEqual([
      `herbal_staff_refresh=${NEW}; Path=/v1/staff/auth; Max-Age=43200; HttpOnly; SameSite=Strict`,
    ]);
  });

  it('answers 401 without a cookie, and forgets a cookie that is refused', async () => {
    const without = setup();
    await expect(
      without.controller.refresh({}, CONSOLE, undefined, without.res),
    ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));
    expect(without.sessions.refresh).not.toHaveBeenCalled();
    expect(without.cookies()).toEqual([
      'herbal_staff_refresh=; Path=/v1/staff/auth; Max-Age=0; HttpOnly; SameSite=Strict',
    ]);

    const refused = setup();
    refused.sessions.refresh.mockRejectedValueOnce(
      new UnauthorizedException('Invalid refresh token'),
    );
    await expect(
      refused.controller.refresh({}, CONSOLE, cookieOf(OLD), refused.res),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(refused.cookies()).toEqual([
      'herbal_staff_refresh=; Path=/v1/staff/auth; Max-Age=0; HttpOnly; SameSite=Strict',
    ]);
  });

  it('keeps the cookie when the refresh fails for another reason, such as the database', async () => {
    const { controller, sessions, res, cookies } = setup();
    const down = new Error("Can't reach database server");
    sessions.refresh.mockRejectedValueOnce(down);

    await expect(
      controller.refresh({}, CONSOLE, cookieOf(OLD), res),
    ).rejects.toBe(down);
    expect(cookies()).toEqual([]);
  });

  it("signs out: the cookie's session ends, and the cookie is forgotten, with or without one", async () => {
    const signedIn = setup();
    await expect(
      signedIn.controller.logout({}, CONSOLE, cookieOf(OLD), signedIn.res),
    ).resolves.toBeUndefined();
    expect(signedIn.sessions.logout).toHaveBeenCalledWith(OLD, 'staff');
    expect(signedIn.cookies()).toEqual([
      'herbal_staff_refresh=; Path=/v1/staff/auth; Max-Age=0; HttpOnly; SameSite=Strict',
    ]);

    const signedOut = setup();
    await signedOut.controller.logout({}, CONSOLE, undefined, signedOut.res);
    expect(signedOut.sessions.logout).not.toHaveBeenCalled();
    expect(signedOut.cookies()).toHaveLength(1);
  });
});

describe('StaffAuthController, from any other client', () => {
  it('signs in with both tokens in the answer, and no cookie, without an Origin or with another', async () => {
    for (const origin of [undefined, 'http://evil.example.com']) {
      const { controller, res, cookies } = setup();

      await expect(
        controller.login(login, '203.0.113.7', context, origin, res),
      ).resolves.toEqual(pair(NEW));
      expect(cookies()).toEqual([]);
    }
  });

  it("refreshes and signs out with the body's token, ignoring any cookie", async () => {
    const { controller, sessions, res, cookies } = setup();

    await expect(
      controller.refresh({ refreshToken: OLD }, undefined, cookieOf(NEW), res),
    ).resolves.toEqual(pair(NEW));
    expect(sessions.refresh).toHaveBeenCalledWith(OLD, 'staff');
    await controller.logout(
      { refreshToken: OLD },
      'http://evil.example.com',
      cookieOf(NEW),
      res,
    );
    expect(sessions.logout).toHaveBeenCalledWith(OLD, 'staff');
    expect(cookies()).toEqual([]);
  });

  it('refuses a missing or malformed body token with 400, as before', async () => {
    const { controller, sessions, res } = setup();

    for (const body of [undefined, {}, { refreshToken: 'short' }]) {
      await expect(
        controller.refresh(body, undefined, cookieOf(OLD), res),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.logout(body, undefined, cookieOf(OLD), res),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(sessions.refresh).not.toHaveBeenCalled();
    expect(sessions.logout).not.toHaveBeenCalled();
  });
});
