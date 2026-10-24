import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { hashToken } from './token.util';

type CreateUserArgs = {
  data: {
    role: string;
    passwordHash: string;
    emailVerificationTokens: { create: { tokenHash: string } };
  };
};

function setup() {
  const tx = {
    emailVerificationToken: { updateMany: jest.fn() },
    user: { updateMany: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    emailVerificationToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (t: typeof tx) => unknown)(tx)
      : Promise.all(arg as unknown[]),
  );
  const passwords = { hash: jest.fn().mockResolvedValue('$argon2id$fake-hash') };
  const mail = {
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendAccountExistsNotice: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3001') };
  const logger = { warn: jest.fn() };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    mail as unknown as MailService,
    config as unknown as ConfigService<Env, true>,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, passwords, mail };
}

const input = {
  email: 'aswin@example.com',
  password: 'a-long-password-1',
  fullName: 'Aswin',
};

describe('AuthService.register', () => {
  it('creates a CUSTOMER with hashed password and token, and emails the raw token', async () => {
    const { service, prisma, mail } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });

    await service.register(input);

    const { data } = prisma.user.create.mock.calls[0][0] as CreateUserArgs;
    expect(data.role).toBe('CUSTOMER');
    expect(data.passwordHash).toBe('$argon2id$fake-hash');
    expect(JSON.stringify(data)).not.toContain(input.password);

    const storedHash = data.emailVerificationTokens.create.tokenHash;
    const url = mail.sendVerificationEmail.mock.calls[0][2] as string;
    const rawToken = new URL(url).searchParams.get('token') as string;
    expect(rawToken).not.toBe(storedHash);
    expect(hashToken(rawToken)).toBe(storedHash);
  });

  it('gives the same answer for an existing email, creates nothing and still hashes', async () => {
    const { service, prisma, passwords, mail } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });
    const forNewEmail = await service.register(input);

    prisma.user.create.mockClear();
    passwords.hash.mockClear();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    const forExistingEmail = await service.register(input);

    expect(forExistingEmail).toEqual(forNewEmail);
    expect(passwords.hash).toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(mail.sendAccountExistsNotice).toHaveBeenCalledWith('aswin@example.com');
  });

  it('treats a simultaneous duplicate registration as an existing account', async () => {
    const { service, prisma, mail } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(service.register(input)).resolves.toBeDefined();
    expect(mail.sendAccountExistsNotice).toHaveBeenCalled();
  });
});

describe('AuthService.verifyEmail', () => {
  it('rejects an unknown token', async () => {
    const { service, prisma } = setup();
    prisma.emailVerificationToken.findUnique.mockResolvedValue(null);
    await expect(service.verifyEmail('x'.repeat(43))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an expired or already used token and verifies nobody', async () => {
    const { service, prisma, tx } = setup();
    prisma.emailVerificationToken.findUnique.mockResolvedValue({ userId: 'u1' });
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.verifyEmail('x'.repeat(43))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('looks the token up by its hash and marks the user verified', async () => {
    const { service, prisma, tx } = setup();
    const raw = 'raw-token-value-'.repeat(3);
    prisma.emailVerificationToken.findUnique.mockResolvedValue({ userId: 'u1' });
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
    tx.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.verifyEmail(raw)).resolves.toEqual({
      message: 'Email address verified.',
    });
    expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(raw) },
      select: { userId: true },
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1', emailVerifiedAt: null } }),
    );
  });
});

describe('AuthService.resendVerification', () => {
  it('answers the same for an unknown email and sends nothing', async () => {
    const { service, prisma, mail } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.resendVerification('nobody@example.com')).resolves.toBeDefined();
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends nothing for an already verified account', async () => {
    const { service, prisma, mail } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      fullName: 'Aswin',
      emailVerifiedAt: new Date(),
    });
    await service.resendVerification('aswin@example.com');
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends nothing during the one-minute cooldown', async () => {
    const { service, prisma, mail } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      fullName: 'Aswin',
      emailVerifiedAt: null,
    });
    prisma.emailVerificationToken.findFirst.mockResolvedValue({ id: 't1' });
    await service.resendVerification('aswin@example.com');
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('replaces unused tokens and emails a new link for an unverified account', async () => {
    const { service, prisma, mail } = setup();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      fullName: 'Aswin',
      emailVerifiedAt: null,
    });
    prisma.emailVerificationToken.findFirst.mockResolvedValue(null);

    await service.resendVerification('aswin@example.com');

    expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).toHaveBeenCalled();
    expect(mail.sendVerificationEmail).toHaveBeenCalledWith(
      'aswin@example.com',
      'Aswin',
      expect.stringContaining('/verify-email?token='),
    );
  });
});
