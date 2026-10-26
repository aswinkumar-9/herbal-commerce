import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import type { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { emailAndIpKey } from './login-limits';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { hashToken } from './token.util';

type CreateTokenArgs = {
  data: { userId: string; tokenHash: string; expiresAt: Date };
};

const EMAIL = 'aswin@example.com';
const IP = '203.0.113.7';
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const customer = {
  id: 'user-1',
  fullName: 'Aswin',
  role: 'CUSTOMER',
  status: 'ACTIVE',
};
// A reset link as the client sends it, and its row as the database returns it.
const RAW_LINK_TOKEN = 'raw-reset-token-value-0123456789abcdef';
const storedLink = {
  id: 'reset-1',
  userId: 'user-1',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  usedAt: null,
  user: {
    email: EMAIL,
    fullName: 'Aswin',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    emailVerifiedAt: null,
  },
};
const resetInput = { token: RAW_LINK_TOKEN, newPassword: 'a-new-long-password-2' };

// Lets the background work after the response finish.
const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const tx = {
    passwordResetToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: { update: jest.fn().mockResolvedValue({ id: 'user-1' }) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(customer) },
    passwordResetToken: {
      findUnique: jest.fn().mockResolvedValue(storedLink),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'reset-1' }),
    },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (client: typeof tx) => unknown)(tx)
        : Promise.all(arg as unknown[]),
    ),
  };
  const passwords = {
    hash: jest.fn().mockResolvedValue('$argon2id$new-hash'),
  };
  const mail = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendPasswordChangedNotice: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3001') };
  const limits = {
    consume: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new PasswordResetService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    mail as unknown as MailService,
    config as unknown as ConfigService<Env, true>,
    limits as unknown as RateLimitService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, passwords, mail, limits, logger };
}

// Runs a reset that must fail and returns the error the client would get.
async function resetError(service: PasswordResetService): Promise<HttpException> {
  try {
    await service.resetPassword(resetInput, IP);
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('the reset unexpectedly succeeded');
}

describe('PasswordResetService.requestReset', () => {
  it('gives the same answer for known and unknown emails', async () => {
    const known = setup();
    const unknown = setup();
    unknown.prisma.user.findUnique.mockResolvedValue(null);

    const forKnown = await known.service.requestReset(EMAIL);
    const forUnknown = await unknown.service.requestReset('nobody@example.com');
    expect(forKnown).toEqual(forUnknown);
  });

  it('answers without waiting for the lookup or the email', async () => {
    const { service, prisma } = setup();
    // A lookup that never finishes must not delay the answer.
    prisma.user.findUnique.mockReturnValue(new Promise(() => undefined));

    await expect(service.requestReset(EMAIL)).resolves.toEqual({
      message: expect.any(String),
    });
  });

  it('emails an active customer a 30-minute link and stores only its hash', async () => {
    const { service, prisma, mail } = setup();

    await service.requestReset(EMAIL);
    await settle();

    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
    });
    const { data } = prisma.passwordResetToken.create.mock
      .calls[0][0] as CreateTokenArgs;
    const url = mail.sendPasswordResetEmail.mock.calls[0][2] as string;
    const rawToken = new URL(url).searchParams.get('token') as string;
    expect(url.startsWith('http://localhost:3001/reset-password?token=')).toBe(true);
    expect(data.tokenHash).not.toBe(rawToken);
    expect(data.tokenHash).toBe(hashToken(rawToken));
    const lifetime = data.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(THIRTY_MINUTES_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(THIRTY_MINUTES_MS);
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledWith(EMAIL, 'Aswin', url);
  });

  it('sends nothing for an unknown email, a staff account or a disabled account', async () => {
    for (const user of [
      null,
      { ...customer, role: 'ADMIN' },
      { ...customer, status: 'DISABLED' },
    ]) {
      const { service, prisma, mail } = setup();
      prisma.user.findUnique.mockResolvedValue(user);

      await service.requestReset(EMAIL);
      await settle();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    }
  });

  it('counts against the emails-to-this-address limit and refuses before any work', async () => {
    const { service, prisma, limits } = setup();
    limits.consume.mockRejectedValueOnce(
      new RetryLaterException(429, 'Too many requests.', 'RATE_LIMITED', 3600),
    );

    await expect(service.requestReset(EMAIL)).rejects.toBeInstanceOf(
      RetryLaterException,
    );
    expect(limits.consume).toHaveBeenCalledWith('emailsToAddress', EMAIL);
    await settle();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('keeps a background failure out of the answer and the email out of the log', async () => {
    const { service, mail, logger } = setup();
    mail.sendPasswordResetEmail.mockRejectedValue(
      new Error(`SMTP refused ${EMAIL}`),
    );

    await expect(service.requestReset(EMAIL)).resolves.toBeDefined();
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      { errorName: 'Error' },
      expect.any(String),
    );
    expect(
      JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]),
    ).not.toContain(EMAIL);
  });
});

describe('PasswordResetService.resetPassword', () => {
  it('sets the new password, verifies the email, ends every session and voids other links', async () => {
    const { service, prisma, tx, passwords } = setup();

    await expect(service.resetPassword(resetInput, IP)).resolves.toEqual({
      message: expect.stringContaining('sign in'),
    });

    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: hashToken(RAW_LINK_TOKEN) },
      }),
    );
    expect(passwords.hash).toHaveBeenCalledWith(resetInput.newPassword);
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'reset-1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: '$argon2id$new-hash', emailVerifiedAt: expect.any(Date) },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
    });
  });

  it('keeps the date of an email that was already verified', async () => {
    const verifiedAt = new Date('2026-10-01T00:00:00Z');
    const { service, prisma, tx } = setup();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      ...storedLink,
      user: { ...storedLink.user, emailVerifiedAt: verifiedAt },
    });

    await service.resetPassword(resetInput, IP);

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailVerifiedAt: verifiedAt }),
      }),
    );
  });

  it('refuses unknown, used and expired links and blocked accounts with one 400, before hashing', async () => {
    const answers: unknown[] = [];
    for (const record of [
      null,
      { ...storedLink, usedAt: new Date() },
      { ...storedLink, expiresAt: new Date(Date.now() - 1000) },
      { ...storedLink, user: { ...storedLink.user, role: 'ADMIN' } },
      { ...storedLink, user: { ...storedLink.user, status: 'DISABLED' } },
    ]) {
      const { service, prisma, passwords } = setup();
      prisma.passwordResetToken.findUnique.mockResolvedValue(record);

      const error = await resetError(service);
      expect(error.getStatus()).toBe(400);
      answers.push(error.getResponse());
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
    for (const answer of answers) {
      expect(answer).toEqual(answers[0]);
    }
  });

  it('refuses the second of two requests racing with the same link', async () => {
    const { service, tx, limits } = setup();
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    expect((await resetError(service)).getStatus()).toBe(400);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(limits.reset).not.toHaveBeenCalled();
  });

  it('lifts the login blocks for this email, and for this email from this IP', async () => {
    const { service, limits } = setup();

    await service.resetPassword(resetInput, IP);

    expect(limits.reset.mock.calls).toEqual([
      ['loginFailuresByEmail', EMAIL],
      ['loginFailuresByEmailAndIp', emailAndIpKey(EMAIL, IP)],
    ]);
  });

  it('tells the owner by email, and a mail failure does not undo the reset', async () => {
    const ok = setup();
    await ok.service.resetPassword(resetInput, IP);
    await settle();
    expect(ok.mail.sendPasswordChangedNotice).toHaveBeenCalledWith(EMAIL, 'Aswin');

    const failing = setup();
    failing.mail.sendPasswordChangedNotice.mockRejectedValue(
      new Error(`SMTP refused ${EMAIL}`),
    );
    await expect(
      failing.service.resetPassword(resetInput, IP),
    ).resolves.toBeDefined();
    await settle();
    expect(failing.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'Error' }),
      expect.any(String),
    );
    expect(JSON.stringify(failing.logger.warn.mock.calls)).not.toContain(EMAIL);
  });
});
