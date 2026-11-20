import type { PinoLogger } from 'nestjs-pino';
import type { AuditService } from '../audit/audit.service';
import type { LoginAttemptsService } from '../auth/login-attempts.service';
import type { PasswordService } from '../auth/password.service';
import { hashToken } from '../auth/token.util';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RateLimitService } from '../rate-limit/rate-limit.service';
import { NO_KEY_YET } from './admin-invitation.service';
import {
  ACCEPT_FIRST,
  AuthenticatorResetService,
  ENABLE_FIRST,
  WRONG_PASSWORD_OR_CODE,
} from './authenticator-reset.service';
import { SETUP_LINK_TTL_MS } from './setup-links.service';
import type { SetupLinksService } from './setup-links.service';
import type { StaffMfaService } from './staff-mfa.service';

const KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};
const admin = {
  id: 'admin-1',
  email: 'dev.admin1@example.com',
  fullName: 'Dev Admin',
};
const REFUSED = { status: 400, message: 'Invalid or expired link' };
// What the limiter throws once a limit is used up.
const tooMany = () => Object.assign(new Error('Too many requests'), { status: 429 });

function setup() {
  const tx = {
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(admin),
    },
    staffInvitation: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    user: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ passwordHash: '$argon2id$theirs' }),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const links = {
    url: jest.fn(
      (_: string, token: string) =>
        `http://localhost:5173/reset-authenticator?token=${token}`,
    ),
    usable: jest.fn().mockResolvedValue({
      id: 'link-1',
      userId: 'admin-1',
      purpose: 'AUTHENTICATOR_RESET',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      email: admin.email,
      fullName: admin.fullName,
      secret: KEY as string | null,
    }),
    refused: jest.fn(() => Object.assign(new Error(REFUSED.message), REFUSED)),
  };
  const mfa = {
    check: jest.fn().mockReturnValue(59_000_001),
    seal: jest.fn((secret: string, boundTo: string) => `sealed:${boundTo}:${secret}`),
  };
  const passwords = { verify: jest.fn().mockResolvedValue(true) };
  const attempts = {
    check: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
    succeeded: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const mail = { sendAuthenticatorReset: jest.fn().mockResolvedValue(undefined) };
  const limits = { consume: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new AuthenticatorResetService(
    prisma as unknown as PrismaService,
    links as unknown as SetupLinksService,
    mfa as unknown as StaffMfaService,
    passwords as unknown as PasswordService,
    attempts as unknown as LoginAttemptsService,
    audit as unknown as AuditService,
    mail as unknown as MailService,
    limits as unknown as RateLimitService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, links, mfa, passwords, attempts, audit, mail, limits, logger };
}

const emailedToken = (mail: ReturnType<typeof setup>['mail']) =>
  new URL(mail.sendAuthenticatorReset.mock.calls[0][2] as string).searchParams.get('token') ?? '';

describe('AuthenticatorResetService.reset (ADR 0038)', () => {
  it('stops the old key at once for an active Admin who accepted, and ends every session', async () => {
    const { service, tx } = setup();

    await service.reset('admin-1', context);

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'admin-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: { not: null },
      },
      data: { mfaSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('replaces every older link with one to set up the app again, for 72 hours, storing only its hash', async () => {
    const { service, tx, mail } = setup();

    const result = await service.reset('admin-1', context);

    const [deleted] = tx.staffInvitation.deleteMany.mock.invocationCallOrder;
    const [cleared] = tx.user.updateMany.mock.invocationCallOrder;
    expect(deleted).toBeLessThan(cleared);
    expect(tx.staffInvitation.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', usedAt: null },
    });
    const [{ data }] = tx.staffInvitation.create.mock.calls[0] as [
      { data: { userId: string; purpose: string; tokenHash: string; expiresAt: Date } },
    ];
    expect(data.purpose).toBe('AUTHENTICATOR_RESET');
    expect(data.tokenHash).toBe(hashToken(emailedToken(mail)));
    const lifetime = data.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(SETUP_LINK_TTL_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(SETUP_LINK_TTL_MS);
    expect(mail.sendAuthenticatorReset).toHaveBeenCalledWith(
      admin.email,
      admin.fullName,
      expect.stringMatching(/^http:\/\/localhost:5173\/reset-authenticator\?token=[\w-]{43}$/),
    );
    expect(result).toEqual({
      ...admin,
      authenticatorLinkExpiresAt: data.expiresAt,
      emailSent: true,
    });
    expect(JSON.stringify(result)).not.toContain(emailedToken(mail));
  });

  it('records who reset it, in the same transaction', async () => {
    const { service, tx, audit } = setup();

    await service.reset('admin-1', context);

    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'admin.authenticator_reset',
      targetType: 'user',
      targetId: 'admin-1',
      after: { authenticatorLinkExpiresAt: expect.any(Date) },
    });
  });

  it('refuses a disabled Admin, a pending one and an unknown ID, and emails nobody', async () => {
    const cases = [
      [{ status: 'DISABLED', emailVerifiedAt: new Date() }, 409, ENABLE_FIRST],
      [{ status: 'ACTIVE', emailVerifiedAt: null }, 409, ACCEPT_FIRST],
      [null, 404, 'Admin not found'],
    ] as const;
    for (const [found, status, message] of cases) {
      const { service, tx, mail, audit } = setup();
      tx.user.updateMany.mockResolvedValue({ count: 0 });
      tx.user.findFirst.mockResolvedValue(found);

      await expect(service.reset('admin-1', context)).rejects.toMatchObject({
        status,
        message,
      });
      expect(tx.staffInvitation.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(mail.sendAuthenticatorReset).not.toHaveBeenCalled();
    }
  });

  it('counts against the emails to that address, and sends nothing when over the limit', async () => {
    const { service, limits, mail } = setup();
    limits.consume.mockRejectedValue(tooMany());

    await expect(service.reset('admin-1', context)).rejects.toMatchObject({
      status: 429,
    });
    expect(limits.consume).toHaveBeenCalledWith('emailsToAddress', admin.email);
    expect(mail.sendAuthenticatorReset).not.toHaveBeenCalled();
  });

  it('keeps the reset when the email fails, says so, and never logs the address or the token', async () => {
    const { service, mail, logger } = setup();
    mail.sendAuthenticatorReset.mockRejectedValue(new Error('SMTP down'));

    const result = await service.reset('admin-1', context);

    expect(result.emailSent).toBe(false);
    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
    expect(logged).toContain('admin-1');
    expect(logged).not.toContain(admin.email);
    expect(logged).not.toContain(emailedToken(mail));
  });
});

describe('AuthenticatorResetService.complete (ADR 0038)', () => {
  const input = {
    token: 'the-token-from-the-emailed-link-1234567890ab',
    password: 'their own password',
    code: '287082',
  };
  const publicContext = { ip: '198.51.100.4', requestId: 'request-2' };

  it('saves the key shown for the link, with the Admin as the actor, and ends every session', async () => {
    const { service, tx, audit, attempts, passwords, mfa, links } = setup();

    await expect(service.complete(input, publicContext)).resolves.toEqual({
      message: 'Your authenticator app is set. Sign in with it.',
    });

    expect(links.usable).toHaveBeenCalledWith(input.token, 'AUTHENTICATOR_RESET');
    expect(passwords.verify).toHaveBeenCalledWith('$argon2id$theirs', input.password);
    expect(mfa.check).toHaveBeenCalledWith(KEY, '287082', expect.any(Number));
    expect(tx.staffInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'link-1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: {
        mfaSecret: `sealed:admin-1:${KEY}`,
        mfaEnabledAt: expect.any(Date),
        mfaLastUsedStep: 59_000_001,
      },
    });
    expect(tx.session.updateMany).toHaveBeenCalled();
    expect(tx.staffInvitation.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', usedAt: null },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...publicContext,
      actorId: 'admin-1',
      action: 'staff.mfa_set_up',
      targetType: 'user',
      targetId: 'admin-1',
      after: { mfaEnabled: true },
    });
    expect(attempts.check).toHaveBeenCalledWith(admin.email, '198.51.100.4');
    expect(attempts.succeeded).toHaveBeenCalledWith(admin.email, '198.51.100.4');
  });

  it('gives one answer for a wrong password or a wrong code, and counts each as a failed sign-in', async () => {
    for (const wrong of ['password', 'code'] as const) {
      const { service, passwords, mfa, attempts, prisma } = setup();
      if (wrong === 'password') {
        passwords.verify.mockResolvedValue(false);
      } else {
        mfa.check.mockReturnValue(null);
      }

      await expect(service.complete(input, publicContext)).rejects.toMatchObject({
        status: 401,
        message: WRONG_PASSWORD_OR_CODE,
      });
      expect(attempts.failed).toHaveBeenCalledWith(admin.email, '198.51.100.4', 'admin-1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      if (wrong === 'password') {
        // A wrong password never tells whether the code was right.
        expect(mfa.check).not.toHaveBeenCalled();
      }
    }
  });

  it('checks the failed sign-in limits before the password, and stops when over them', async () => {
    const { service, attempts, passwords } = setup();
    attempts.check.mockRejectedValue(tooMany());

    await expect(service.complete(input, publicContext)).rejects.toMatchObject({
      status: 429,
    });
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('refuses at the code a link whose key was never shown, and a link that cannot be used, before any password work', async () => {
    const { service, links, passwords } = setup();
    links.usable.mockResolvedValueOnce({
      ...(await links.usable()),
      secret: null,
    });
    await expect(service.complete(input, publicContext)).rejects.toMatchObject({
      status: 400,
      response: { errors: [{ field: 'code', message: NO_KEY_YET }] },
    });

    links.usable.mockRejectedValueOnce(Object.assign(new Error(REFUSED.message), REFUSED));
    await expect(service.complete(input, publicContext)).rejects.toMatchObject(REFUSED);
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('refuses the second of two requests with the same link, and changes nothing', async () => {
    const { service, tx, audit, attempts, links } = setup();
    tx.staffInvitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.complete(input, publicContext)).rejects.toMatchObject(REFUSED);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(attempts.succeeded).not.toHaveBeenCalled();
    expect(links.refused).toHaveBeenCalledWith('AUTHENTICATOR_RESET', 'lost_race', 'admin-1');
  });
});
