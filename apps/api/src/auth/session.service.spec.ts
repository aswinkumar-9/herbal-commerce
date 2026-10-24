import { HttpException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenService } from './access-token.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { hashToken } from './token.util';

type SessionCreateArgs = {
  data: {
    userId: string;
    expiresAt: Date;
    refreshTokens: { create: { tokenHash: string } };
  };
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const input = { email: 'asha@example.com', password: 'a-long-password-1' };
const customer = {
  id: 'user-1',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  passwordHash: '$argon2id$fake-hash',
  emailVerifiedAt: new Date('2026-10-01T00:00:00Z'),
};

function setup() {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(customer) },
    session: { create: jest.fn().mockResolvedValue({ id: 'session-1' }) },
  };
  const passwords = {
    verify: jest.fn().mockResolvedValue(true),
    verifyDummy: jest.fn().mockResolvedValue(false),
  };
  const accessTokens = {
    sign: jest.fn().mockResolvedValue('signed-access-token'),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new SessionService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    accessTokens as unknown as AccessTokenService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, passwords, accessTokens, logger };
}

// Runs a login that must fail and returns the error the client would get.
async function rejection(service: SessionService): Promise<HttpException> {
  try {
    await service.login(input);
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('login unexpectedly succeeded');
}

describe('SessionService.login', () => {
  it('starts a 30-day session and stores only the hash of the refresh token', async () => {
    const { service, prisma, accessTokens } = setup();

    const tokens = await service.login(input);

    expect(tokens).toEqual({
      accessToken: 'signed-access-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshToken: expect.any(String),
    });
    const { data } = prisma.session.create.mock.calls[0][0] as SessionCreateArgs;
    expect(data.userId).toBe('user-1');
    const lifetime = data.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(THIRTY_DAYS_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(THIRTY_DAYS_MS);
    const storedHash = data.refreshTokens.create.tokenHash;
    expect(storedHash).not.toBe(tokens.refreshToken);
    expect(storedHash).toBe(hashToken(tokens.refreshToken));
    expect(accessTokens.sign).toHaveBeenCalledWith({
      id: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('gives one answer for an unknown email, a wrong password and an unverified email', async () => {
    const unknown = setup();
    unknown.prisma.user.findUnique.mockResolvedValue(null);
    const wrongPassword = setup();
    wrongPassword.passwords.verify.mockResolvedValue(false);
    const unverified = setup();
    unverified.prisma.user.findUnique.mockResolvedValue({
      ...customer,
      emailVerifiedAt: null,
    });

    const errors = [
      await rejection(unknown.service),
      await rejection(wrongPassword.service),
      await rejection(unverified.service),
    ];

    for (const error of errors) {
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toEqual(errors[0].getResponse());
    }
    expect(unknown.passwords.verifyDummy).toHaveBeenCalledWith(input.password);
    for (const { prisma } of [unknown, wrongPassword, unverified]) {
      expect(prisma.session.create).not.toHaveBeenCalled();
    }
  });

  it('treats a staff account like an unknown email and never checks its password', async () => {
    const { service, prisma, passwords, logger } = setup();
    prisma.user.findUnique.mockResolvedValue({ ...customer, role: 'ADMIN' });

    expect((await rejection(service)).getStatus()).toBe(401);
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(passwords.verifyDummy).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'not_customer' }),
      expect.any(String),
    );
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('says an account is disabled only after the correct password', async () => {
    const correct = setup();
    correct.prisma.user.findUnique.mockResolvedValue({
      ...customer,
      status: 'DISABLED',
    });
    const wrong = setup();
    wrong.prisma.user.findUnique.mockResolvedValue({
      ...customer,
      status: 'DISABLED',
    });
    wrong.passwords.verify.mockResolvedValue(false);

    const disabled = await rejection(correct.service);
    expect(disabled.getStatus()).toBe(403);
    expect(disabled.getResponse()).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect((await rejection(wrong.service)).getStatus()).toBe(401);
    expect(correct.prisma.session.create).not.toHaveBeenCalled();
  });

  it('never logs the email, the password or the tokens', async () => {
    const success = setup();
    const tokens = await success.service.login(input);
    const failure = setup();
    failure.passwords.verify.mockResolvedValue(false);
    await rejection(failure.service);

    const logged = JSON.stringify([
      success.logger.info.mock.calls,
      success.logger.warn.mock.calls,
      failure.logger.info.mock.calls,
      failure.logger.warn.mock.calls,
    ]);
    expect(logged).toContain('session-1');
    for (const secret of [
      input.email,
      input.password,
      tokens.refreshToken,
      tokens.accessToken,
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
