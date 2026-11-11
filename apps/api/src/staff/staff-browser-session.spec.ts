import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../config/env';
import {
  readCookie,
  STAFF_COOKIE_PATH,
  STAFF_REFRESH_COOKIE,
  StaffBrowserSession,
} from './staff-browser-session';

const TOKEN = 'rT0k3n_abcdefghijklmnopqrstuvwxyz-0123456';
const tokens = {
  accessToken: 'access.jwt.value',
  tokenType: 'Bearer' as const,
  expiresIn: 900,
  refreshToken: TOKEN,
};

function setup(origin = 'http://localhost:5173') {
  const config = { get: jest.fn().mockReturnValue(origin) };
  const response = { setHeader: jest.fn() };
  return {
    browser: new StaffBrowserSession(
      config as unknown as ConfigService<Env, true>,
    ),
    config,
    response,
    res: response as unknown as Response,
  };
}

describe('StaffBrowserSession', () => {
  it('knows the console by its exact origin, from the configuration', () => {
    const { browser, config } = setup();

    expect(config.get).toHaveBeenCalledWith('ADMIN_ORIGIN', { infer: true });
    expect(browser.fromConsole('http://localhost:5173')).toBe(true);
    for (const other of [
      undefined,
      '',
      'null',
      'http://localhost:5174',
      'https://localhost:5173',
      'http://localhost:5173/',
      'http://evil.example.com',
    ]) {
      expect(browser.fromConsole(other)).toBe(false);
    }
  });

  it('answers the console its access token, and keeps the refresh token in a cookie scripts never see', () => {
    const { browser, response, res } = setup();

    expect(browser.answer(tokens, res)).toStrictEqual({
      accessToken: 'access.jwt.value',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      `herbal_staff_refresh=${TOKEN}; Path=/v1/staff/auth; Max-Age=43200; HttpOnly; SameSite=Strict`,
    );
    expect(STAFF_REFRESH_COOKIE).toBe('herbal_staff_refresh');
    expect(STAFF_COOKIE_PATH).toBe('/v1/staff/auth');
  });

  it('makes the cookie Secure when the console is on https', () => {
    const { browser, response, res } = setup('https://admin.example.com');

    browser.answer(tokens, res);
    browser.clear(res);

    expect(response.setHeader.mock.calls.map(([, value]) => value)).toEqual([
      `herbal_staff_refresh=${TOKEN}; Path=/v1/staff/auth; Max-Age=43200; HttpOnly; SameSite=Strict; Secure`,
      'herbal_staff_refresh=; Path=/v1/staff/auth; Max-Age=0; HttpOnly; SameSite=Strict; Secure',
    ]);
  });

  it('reads the token from the cookie, and answers 401 without one', () => {
    const { browser } = setup();

    expect(browser.token(`theme=dark; herbal_staff_refresh=${TOKEN}`)).toBe(
      TOKEN,
    );
    expect(browser.tokenIfAny(`herbal_staff_refresh=${TOKEN}`)).toBe(TOKEN);
    for (const header of [undefined, '', 'theme=dark']) {
      expect(() => browser.token(header)).toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
      expect(browser.tokenIfAny(header)).toBeUndefined();
    }
  });
});

describe('readCookie', () => {
  it('finds one cookie by its exact name, among others and spaces', () => {
    expect(
      readCookie(
        `a=1; herbal_staff_refresh=${TOKEN}; b=2`,
        'herbal_staff_refresh',
      ),
    ).toBe(TOKEN);
    expect(
      readCookie(` herbal_staff_refresh = ${TOKEN} `, 'herbal_staff_refresh'),
    ).toBe(TOKEN);
    expect(
      readCookie(`x_herbal_staff_refresh=${TOKEN}`, 'herbal_staff_refresh'),
    ).toBeUndefined();
    expect(
      readCookie(`herbal_staff_refresh_old=${TOKEN}`, 'herbal_staff_refresh'),
    ).toBeUndefined();
  });

  it('ignores a value that is not a token: empty, too short, too long, or with other characters', () => {
    for (const value of [
      '',
      'short',
      'a'.repeat(201),
      `${TOKEN}%00`,
      `"${TOKEN}"`,
      `${TOKEN} x`,
    ]) {
      expect(
        readCookie(`herbal_staff_refresh=${value}`, 'herbal_staff_refresh'),
      ).toBeUndefined();
    }
  });
});
