import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginAttemptsService } from './login-attempts.service';
import { PasswordChangeService } from './password-change.service';
import { PasswordService } from './password.service';

const IP = '203.0.113.7';
const input = {
  currentPassword: 'the-current-password-1',
  newPassword: 'a-brand-new-password-2',
};
const customer = {
  email: 'asha@example.com',
  fullName: 'Asha',
  passwordHash: '$argon2id$current-hash',
};

function setup() {
  const tx = {
    user: { update: jest.fn().mockResolvedValue({}) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    passwordResetToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(customer) },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const passwords = {
    verify: jest.fn().mockResolvedValue(true),
    hash: jest.fn().mockResolvedValue('$argon2id$new-hash'),
  };
  const attempts = {
    check: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
    succeeded: jest.fn().mockResolvedValue(undefined),
  };
  const mail = {
    sendPasswordChangedNotice: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new PasswordChangeService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    attempts as unknown as LoginAttemptsService,
    mail as unknown as MailService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, passwords, attempts, mail, logger };
}

describe('PasswordChangeService.change', () => {
  it('sets the new password, checked against the current one', async () => {
    const { service, passwords, tx } = setup();

    await expect(service.change('user-1', input, IP)).resolves.toEqual({
      message:
        'Your password has been changed. Please sign in again with your new password.',
    });

    expect(passwords.verify).toHaveBeenCalledWith(
      customer.passwordHash,
      input.currentPassword,
    );
    expect(passwords.hash).toHaveBeenCalledWith(input.newPassword);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: '$argon2id$new-hash' },
    });
  });

  it('ends every session and every waiting reset link, in the same transaction', async () => {
    const { service, tx } = setup();

    await service.change('user-1', input, IP);

    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
    });
  });

  it('refuses a wrong current password with 400, counts it like a failed login, and changes nothing', async () => {
    const { service, prisma, passwords, attempts, mail } = setup();
    passwords.verify.mockResolvedValue(false);

    await expect(service.change('user-1', input, IP)).rejects.toThrow(
      new BadRequestException('The current password is wrong.'),
    );
    expect(attempts.failed).toHaveBeenCalledWith(customer.email, IP, 'user-1');
    expect(attempts.succeeded).not.toHaveBeenCalled();
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mail.sendPasswordChangedNotice).not.toHaveBeenCalled();
  });

  it('answers 429 instead for the wrong guess that goes over a limit', async () => {
    const { service, passwords, attempts } = setup();
    passwords.verify.mockResolvedValue(false);
    attempts.failed.mockRejectedValue(
      new RetryLaterException(429, 'Too many requests.', 'RATE_LIMITED', 900),
    );

    await expect(service.change('user-1', input, IP)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('refuses with 429 before any password work while a login limit is exceeded', async () => {
    const { service, passwords, attempts } = setup();
    attempts.check.mockRejectedValue(
      new RetryLaterException(429, 'Too many requests.', 'RATE_LIMITED', 900),
    );

    await expect(service.change('user-1', input, IP)).rejects.toMatchObject({
      status: 429,
    });
    expect(attempts.check).toHaveBeenCalledWith(customer.email, IP);
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('clears the failed-login count and sends the changed notice afterwards', async () => {
    const { service, attempts, mail } = setup();

    await service.change('user-1', input, IP);

    expect(attempts.succeeded).toHaveBeenCalledWith(customer.email, IP);
    expect(mail.sendPasswordChangedNotice).toHaveBeenCalledWith(
      customer.email,
      customer.fullName,
    );
  });

  it('keeps the change when the notice cannot be sent', async () => {
    const { service, mail, logger } = setup();
    mail.sendPasswordChangedNotice.mockRejectedValue(new Error('SMTP down'));

    await expect(service.change('user-1', input, IP)).resolves.toBeDefined();
    // The notice is sent in the background: let it finish.
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.warn).toHaveBeenCalledWith(
      { errorName: 'Error', userId: 'user-1' },
      'Failed to send the password changed notice',
    );
  });

  it('answers 401 if the account no longer exists', async () => {
    const { service, prisma, passwords } = setup();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.change('user-1', input, IP)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('never logs a password or the email address', async () => {
    const wrong = setup();
    wrong.passwords.verify.mockResolvedValue(false);
    await wrong.service.change('user-1', input, IP).catch(() => undefined);
    const right = setup();
    await right.service.change('user-1', input, IP);

    const logged = JSON.stringify([
      wrong.logger.warn.mock.calls,
      right.logger.info.mock.calls,
    ]);
    expect(logged).toContain('user-1');
    for (const secret of [
      input.currentPassword,
      input.newPassword,
      customer.email,
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
