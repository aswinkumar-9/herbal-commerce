import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import type { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { PasswordResetService } from './password-reset.service';
import { hashToken } from './token.util';

type CreateTokenArgs = {
  data: { userId: string; tokenHash: string; expiresAt: Date };
};

const EMAIL = 'aswin@example.com';
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const customer = {
  id: 'user-1',
  fullName: 'Aswin',
  role: 'CUSTOMER',
  status: 'ACTIVE',
};

// Lets the background work after the response finish.
const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(customer) },
    passwordResetToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'reset-1' }),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
  };
  const mail = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3001') };
  const limits = { consume: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new PasswordResetService(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
    config as unknown as ConfigService<Env, true>,
    limits as unknown as RateLimitService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, mail, limits, logger };
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
