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
// A refresh token as the client sends it, and its row as the database returns it.
const RAW_REFRESH_TOKEN = 'raw-refresh-token-value-0123456789abcdef';
const liveSession = {
  id: 'session-1',
  expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
  revokedAt: null,
  user: { id: 'user-1', role: 'CUSTOMER', status: 'ACTIVE' },
};
const storedToken = { id: 'token-1', usedAt: null, session: liveSession };

function setup() {
  const tx = {
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'token-2' }),
    },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(customer) },
    session: {
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    refreshToken: { findUnique: jest.fn().mockResolvedValue(storedToken) },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const passwords = {
    verify: jest.fn().mockResolvedValue(true),
    verifyDummy: jest.fn().mockResolvedValue(false),
  };
  const accessTokens = {
    sign: jest.fn().mockResolvedValue('signed-access-token'),
  };
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const service = new SessionService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    accessTokens as unknown as AccessTokenService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, passwords, accessTokens, logger };
}

// Runs a call that must fail and returns the error the client would get.
async function rejection(run: () => Promise<unknown>): Promise<HttpException> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('the call unexpectedly succeeded');
}

const loginError = (service: SessionService) =>
  rejection(() => service.login(input));
const refreshError = (service: SessionService) =>
  rejection(() => service.refresh(RAW_REFRESH_TOKEN));

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
      await loginError(unknown.service),
      await loginError(wrongPassword.service),
      await loginError(unverified.service),
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

    expect((await loginError(service)).getStatus()).toBe(401);
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

    const disabled = await loginError(correct.service);
    expect(disabled.getStatus()).toBe(403);
    expect(disabled.getResponse()).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect((await loginError(wrong.service)).getStatus()).toBe(401);
    expect(correct.prisma.session.create).not.toHaveBeenCalled();
  });

  it('never logs the email, the password or the tokens', async () => {
    const success = setup();
    const tokens = await success.service.login(input);
    const failure = setup();
    failure.passwords.verify.mockResolvedValue(false);
    await loginError(failure.service);

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

describe('SessionService.refresh', () => {
  it('swaps a refresh token for a new pair and marks the old one used', async () => {
    const { service, prisma, tx, accessTokens } = setup();

    const tokens = await service.refresh(RAW_REFRESH_TOKEN);

    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: hashToken(RAW_REFRESH_TOKEN) },
      }),
    );
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'token-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(tokens.refreshToken).not.toBe(RAW_REFRESH_TOKEN);
    expect(tx.refreshToken.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        tokenHash: hashToken(tokens.refreshToken),
      },
    });
    expect(accessTokens.sign).toHaveBeenCalledWith({
      id: 'user-1',
      sessionId: 'session-1',
    });
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('revokes the whole session when a used refresh token comes back', async () => {
    const { service, prisma, logger } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue({
      ...storedToken,
      usedAt: new Date(),
    });

    expect((await refreshError(service)).getStatus()).toBe(401);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'token_reused', sessionId: 'session-1' }),
      expect.any(String),
    );
  });

  it('treats losing a race for the same token as reuse', async () => {
    const { service, prisma, tx, accessTokens } = setup();
    tx.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    expect((await refreshError(service)).getStatus()).toBe(401);
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.session.updateMany).toHaveBeenCalled();
    expect(accessTokens.sign).not.toHaveBeenCalled();
  });

  it('ends the session when the account is disabled or no longer a customer', async () => {
    for (const user of [
      { ...liveSession.user, status: 'DISABLED' },
      { ...liveSession.user, role: 'ADMIN' },
    ]) {
      const { service, prisma } = setup();
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        session: { ...liveSession, user },
      });

      expect((await refreshError(service)).getStatus()).toBe(401);
      expect(prisma.session.updateMany).toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('refuses unknown tokens and ended sessions without issuing anything', async () => {
    for (const record of [
      null,
      { ...storedToken, session: { ...liveSession, revokedAt: new Date() } },
      {
        ...storedToken,
        session: { ...liveSession, expiresAt: new Date(Date.now() - 1000) },
      },
    ]) {
      const { service, prisma, accessTokens } = setup();
      prisma.refreshToken.findUnique.mockResolvedValue(record);

      expect((await refreshError(service)).getStatus()).toBe(401);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
      expect(accessTokens.sign).not.toHaveBeenCalled();
    }
  });

  it('gives the same answer for every failed refresh and never logs the token', async () => {
    const answers: unknown[] = [];
    for (const record of [
      null,
      { ...storedToken, usedAt: new Date() },
      { ...storedToken, session: { ...liveSession, revokedAt: new Date() } },
      {
        ...storedToken,
        session: {
          ...liveSession,
          user: { ...liveSession.user, status: 'DISABLED' },
        },
      },
    ]) {
      const { service, prisma, logger } = setup();
      prisma.refreshToken.findUnique.mockResolvedValue(record);

      answers.push((await refreshError(service)).getResponse());
      expect(
        JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]),
      ).not.toContain(RAW_REFRESH_TOKEN);
    }
    for (const answer of answers) {
      expect(answer).toEqual(answers[0]);
    }
  });
});

describe('SessionService.logout', () => {
  it('revokes the session the refresh token belongs to', async () => {
    const { service, prisma } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue({
      sessionId: 'session-1',
      session: { userId: 'user-1' },
    });

    await expect(service.logout(RAW_REFRESH_TOKEN)).resolves.toBeUndefined();
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('quietly does nothing for an unknown token', async () => {
    const { service, prisma } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.logout(RAW_REFRESH_TOKEN)).resolves.toBeUndefined();
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });
});

describe('SessionService.isActive', () => {
  function withSession(found: { id: string } | null) {
    const findFirst = jest.fn().mockResolvedValue(found);
    const service = new SessionService(
      { session: { findFirst } } as unknown as PrismaService,
      {} as PasswordService,
      {} as AccessTokenService,
      {} as PinoLogger,
    );
    return { service, findFirst };
  }

  it('accepts only a live session of an active customer', async () => {
    const { service, findFirst } = withSession({ id: 'session-1' });

    await expect(service.isActive('user-1', 'session-1')).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
        user: { role: 'CUSTOMER', status: 'ACTIVE' },
      },
      select: { id: true },
    });
  });

  it('says no when the session is revoked, expired or not this user', async () => {
    const { service } = withSession(null);

    await expect(service.isActive('user-1', 'session-1')).resolves.toBe(false);
  });
});
