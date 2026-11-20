import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { hashToken } from '../auth/token.util';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminInvitationService,
  INVITATION_TTL_MS,
  NO_KEY_YET,
  WRONG_CODE,
} from './admin-invitation.service';
import type { SetupLinksService } from './setup-links.service';
import type { StaffMfaService } from './staff-mfa.service';

type UserCreateArgs = {
  data: {
    email: string;
    fullName: string;
    passwordHash: string;
    role: string;
    staffInvitations: { create: { tokenHash: string; expiresAt: Date } };
  };
};

const input = { email: 'dev.admin1@example.com', fullName: 'Dev Admin' };
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};
const created = { id: 'admin-1', ...input };

// An invitation that may still be used, as SetupLinksService.usable() finds
// it, with the key shown when the link was opened.
function usableLink(changes: object = {}) {
  return {
    id: 'invitation-1',
    userId: 'admin-1',
    purpose: 'INVITE',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    email: 'dev.admin1@example.com',
    fullName: 'Dev Admin',
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    ...changes,
  };
}
const REFUSED = { status: 400, message: 'Invalid or expired invitation link' };

function setup() {
  const tx = {
    user: {
      create: jest.fn().mockResolvedValue(created),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(created),
    },
    staffInvitation: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('$argon2id$unusable') };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const mail = { sendAdminInvitation: jest.fn().mockResolvedValue(undefined) };
  const links = {
    url: jest.fn(
      (purpose: string, token: string) =>
        `http://localhost:5173/${purpose === 'INVITE' ? 'accept-invite' : 'reset-authenticator'}?token=${encodeURIComponent(token)}`,
    ),
    usable: jest.fn().mockResolvedValue(usableLink()),
    refused: jest.fn(() => Object.assign(new Error(REFUSED.message), REFUSED)),
  };
  const mfa = {
    check: jest.fn().mockReturnValue(59_000_000),
    seal: jest.fn((secret: string, boundTo: string) => `sealed:${boundTo}:${secret}`),
  };
  const limits = { consume: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new AdminInvitationService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    audit as unknown as AuditService,
    mail as unknown as MailService,
    links as unknown as SetupLinksService,
    mfa as unknown as StaffMfaService,
    limits as unknown as RateLimitService,
    logger as unknown as PinoLogger,
  );
  return {
    service,
    prisma,
    tx,
    passwords,
    audit,
    mail,
    links,
    mfa,
    limits,
    logger,
  };
}

// The token in the emailed link.
function emailedToken(mail: ReturnType<typeof setup>['mail']): string {
  const [, , url] = mail.sendAdminInvitation.mock.calls[0] as string[];
  return new URL(url).searchParams.get('token') ?? '';
}

describe('AdminInvitationService.invite', () => {
  it('creates an Admin with a password nobody knows, and an invitation for 72 hours', async () => {
    const { service, tx, passwords } = setup();

    await service.invite(input, context);

    const { data } = tx.user.create.mock.calls[0][0] as UserCreateArgs;
    expect(data).toMatchObject({ ...input, role: 'ADMIN' });
    // A random value, hashed: not the email, the name or anything typed.
    const [unusable] = passwords.hash.mock.calls[0] as [string];
    expect(unusable).toHaveLength(43);
    expect(data.passwordHash).toBe('$argon2id$unusable');
    const lifetime =
      data.staffInvitations.create.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(INVITATION_TTL_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(INVITATION_TTL_MS);
  });

  it('emails the link, and stores only the hash of its token', async () => {
    const { service, tx, mail } = setup();

    await service.invite(input, context);

    expect(mail.sendAdminInvitation).toHaveBeenCalledWith(
      'dev.admin1@example.com',
      'Dev Admin',
      expect.stringMatching(
        /^http:\/\/localhost:5173\/accept-invite\?token=/,
      ),
    );
    const token = emailedToken(mail);
    const { data } = tx.user.create.mock.calls[0][0] as UserCreateArgs;
    expect(data.staffInvitations.create.tokenHash).toBe(hashToken(token));
    expect(data.staffInvitations.create.tokenHash).not.toBe(token);
  });

  it('writes the audit entry with who, from where and in which request, in the same transaction', async () => {
    const { service, tx, audit } = setup();

    await service.invite(input, context);

    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorId: context.actorId,
      ip: '203.0.113.7',
      requestId: 'request-1',
      action: 'admin.invited',
      targetType: 'user',
      targetId: 'admin-1',
      after: { email: input.email, fullName: input.fullName, role: 'ADMIN' },
    });
  });

  it('answers with the new Admin, never with the token', async () => {
    const { service, mail } = setup();

    const result = await service.invite(input, context);

    expect(result).toEqual({
      id: 'admin-1',
      email: 'dev.admin1@example.com',
      fullName: 'Dev Admin',
      role: 'ADMIN',
      invitationExpiresAt: expect.any(Date),
      invitationSent: true,
    });
    expect(JSON.stringify(result)).not.toContain(emailedToken(mail));
  });

  it('refuses an email that already has an account with 409, and creates nothing', async () => {
    const { service, prisma, passwords, mail } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'customer-1' });

    await expect(service.invite(input, context)).rejects.toMatchObject({
      status: 409,
    });
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mail.sendAdminInvitation).not.toHaveBeenCalled();
  });

  it('treats the same email invited at the same moment as already existing', async () => {
    const { service, tx, audit, mail } = setup();
    tx.user.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(service.invite(input, context)).rejects.toMatchObject({
      status: 409,
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(mail.sendAdminInvitation).not.toHaveBeenCalled();
  });

  it('keeps the Admin when the email fails, and says so', async () => {
    const { service, mail, logger } = setup();
    mail.sendAdminInvitation.mockRejectedValue(new Error('SMTP down'));

    const result = await service.invite(input, context);

    expect(result.invitationSent).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      { userId: 'admin-1', errorName: 'Error' },
      'Failed to send an Admin invitation',
    );
  });

  it('never logs the email address or the token', async () => {
    const { service, mail, logger } = setup();

    await service.invite(input, context);

    const logged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
    ]);
    expect(logged).toContain('admin-1');
    expect(logged).not.toContain(input.email);
    expect(logged).not.toContain(emailedToken(mail));
  });
});

describe('AdminInvitationService.accept', () => {
  const acceptInput = {
    token: 'the-token-from-the-invitation-link-123456789',
    password: 'the-admin-chose-this',
    code: '287082',
  };
  // A public route: nobody is signed in, so there is no actorId.
  const publicContext = { ip: '198.51.100.4', requestId: 'request-2' };

  it('sets the chosen password and the authenticator key together, verifies the email and ends every session', async () => {
    const { service, links, tx, passwords, mfa, logger } = setup();
    passwords.hash.mockResolvedValue('$argon2id$chosen');

    await expect(service.accept(acceptInput, publicContext)).resolves.toEqual({
      message: 'Your password and authenticator app are set. Sign in with them.',
    });

    expect(links.usable).toHaveBeenCalledWith(acceptInput.token, 'INVITE');
    expect(mfa.check).toHaveBeenCalledWith(
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      '287082',
      expect.any(Number),
    );
    expect(passwords.hash).toHaveBeenCalledWith('the-admin-chose-this');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: {
        passwordHash: '$argon2id$chosen',
        emailVerifiedAt: expect.any(Date),
        // Sealed for the account, not for the link any more.
        mfaSecret: 'sealed:admin-1:JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        mfaEnabledAt: expect.any(Date),
        // The code just typed does not also sign in.
        mfaLastUsedStep: 59_000_000,
      },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { userId: 'admin-1' },
      'Admin invitation accepted: password and authenticator set',
    );
  });

  it('uses the link up in one atomic step, and ends any other link', async () => {
    const { service, tx } = setup();

    await service.accept(acceptInput, publicContext);

    expect(tx.staffInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invitation-1',
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { usedAt: expect.any(Date) },
    });
    expect(tx.staffInvitation.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', usedAt: null },
    });
  });

  it('writes both audit entries with the Admin as the actor, in the same transaction', async () => {
    const { service, tx, audit } = setup();

    await service.accept(acceptInput, publicContext);

    const base = {
      actorId: 'admin-1',
      ip: '198.51.100.4',
      requestId: 'request-2',
      targetType: 'user',
      targetId: 'admin-1',
    };
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...base,
      action: 'admin.invite_accepted',
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...base,
      action: 'staff.mfa_set_up',
      after: { mfaEnabled: true },
    });
  });

  it('refuses a link that cannot be used, before any password work', async () => {
    const { service, links, passwords, prisma } = setup();
    links.usable.mockRejectedValue(
      Object.assign(new Error(REFUSED.message), REFUSED),
    );

    await expect(
      service.accept(acceptInput, publicContext),
    ).rejects.toMatchObject(REFUSED);
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses at the code a link whose key was never shown, or a code the key did not make, before any password work', async () => {
    for (const [changes, wrong, message] of [
      [{ secret: null }, false, NO_KEY_YET],
      [{}, true, WRONG_CODE],
    ] as const) {
      const { service, links, mfa, passwords, prisma } = setup();
      links.usable.mockResolvedValue(usableLink(changes));
      if (wrong) {
        mfa.check.mockReturnValue(null);
      }

      await expect(
        service.accept(acceptInput, publicContext),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          message: 'Validation failed',
          errors: [{ field: 'code', message }],
        },
      });
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('refuses the second of two requests with the same link, and changes nothing', async () => {
    const { service, tx, audit, links } = setup();
    tx.staffInvitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.accept(acceptInput, publicContext),
    ).rejects.toMatchObject(REFUSED);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(links.refused).toHaveBeenCalledWith('INVITE', 'lost_race', 'admin-1');
  });

  it('never logs the password, the code, the key or the token', async () => {
    const { service, logger } = setup();

    await service.accept(acceptInput, publicContext);

    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).toContain('admin-1');
    expect(logged).not.toContain(acceptInput.token);
    expect(logged).not.toContain(acceptInput.password);
    expect(logged).not.toContain(acceptInput.code);
    expect(logged).not.toContain('JBSWY3DPEHPK3PXP');
  });
});

describe('AdminInvitationService.resend', () => {
  it('checks atomically that the Admin is still pending and active', async () => {
    const { service, tx } = setup();

    await service.resend('admin-1', context);

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'admin-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: null,
      },
      data: { updatedAt: expect.any(Date) as Date },
    });
  });

  it('takes the invitation rows before the Admin row, in the same order as accept', async () => {
    const { service, tx } = setup();

    await service.resend('admin-1', context);

    // Opposite orders could make the two wait for each other (a deadlock).
    const [invitations] =
      tx.staffInvitation.deleteMany.mock.invocationCallOrder;
    const [adminRow] = tx.user.updateMany.mock.invocationCallOrder;
    expect(invitations).toBeLessThan(adminRow);
  });

  it('replaces every older link with a new one for 72 hours, storing only its hash', async () => {
    const { service, tx, mail } = setup();
    const before = Date.now();

    await service.resend('admin-1', context);

    expect(tx.staffInvitation.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', usedAt: null },
    });
    const [args] = tx.staffInvitation.create.mock.calls[0] as [
      { data: { userId: string; tokenHash: string; expiresAt: Date } },
    ];
    expect(args.data.userId).toBe('admin-1');
    expect(args.data.tokenHash).toBe(hashToken(emailedToken(mail)));
    expect(args.data.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + INVITATION_TTL_MS,
    );
    // The old links go first, so the new one is the only one left.
    const [deleted] = tx.staffInvitation.deleteMany.mock.invocationCallOrder;
    const [added] = tx.staffInvitation.create.mock.invocationCallOrder;
    expect(deleted).toBeLessThan(added);
    expect(mail.sendAdminInvitation).toHaveBeenCalledWith(
      input.email,
      input.fullName,
      expect.stringMatching(
        /^http:\/\/localhost:5173\/accept-invite\?token=[\w-]{43}$/,
      ),
    );
  });

  it('records who sent it again, in the same transaction', async () => {
    const { service, tx, audit } = setup();

    await service.resend('admin-1', context);

    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'admin.invitation_resent',
      targetType: 'user',
      targetId: 'admin-1',
      after: { invitationExpiresAt: expect.any(Date) as Date },
    });
  });

  it('answers with the Admin and when the new link ends, never with the token', async () => {
    const { service, mail } = setup();

    const result = await service.resend('admin-1', context);

    expect(result).toEqual({
      id: 'admin-1',
      email: input.email,
      fullName: input.fullName,
      role: 'ADMIN',
      invitationExpiresAt: expect.any(Date) as Date,
      invitationSent: true,
    });
    expect(JSON.stringify(result)).not.toContain(emailedToken(mail));
  });

  it('counts against the emails to that address, and changes nothing when over the limit', async () => {
    const { service, prisma, tx, limits, mail } = setup();
    limits.consume.mockRejectedValue(new Error('Too many requests'));

    await expect(service.resend('admin-1', context)).rejects.toThrow(
      'Too many requests',
    );
    expect(limits.consume).toHaveBeenCalledWith(
      'emailsToAddress',
      input.email,
    );
    // Thrown inside the transaction, so the old links are kept.
    await expect(prisma.$transaction.mock.results[0].value).rejects.toThrow(
      'Too many requests',
    );
    expect(tx.staffInvitation.create).not.toHaveBeenCalled();
    expect(mail.sendAdminInvitation).not.toHaveBeenCalled();
  });

  it('refuses an Admin who has accepted, a disabled one, and an unknown ID', async () => {
    const cases = [
      {
        stored: { emailVerifiedAt: new Date() },
        answer: {
          status: 409,
          message: 'This Admin has already accepted the invitation.',
        },
      },
      {
        stored: { emailVerifiedAt: null },
        answer: {
          status: 409,
          message: 'Enable this Admin before inviting them again.',
        },
      },
      { stored: null, answer: { status: 404, message: 'Admin not found' } },
    ];
    for (const { stored, answer } of cases) {
      const { service, prisma, tx, limits, audit, mail } = setup();
      tx.user.updateMany.mockResolvedValue({ count: 0 });
      tx.user.findFirst.mockResolvedValue(stored);

      await expect(service.resend('admin-1', context)).rejects.toMatchObject(
        answer,
      );
      // Thrown inside the transaction, so it is undone, old links included.
      await expect(
        prisma.$transaction.mock.results[0].value,
      ).rejects.toMatchObject(answer);
      expect(tx.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'admin-1', role: 'ADMIN' },
        select: { emailVerifiedAt: true },
      });
      expect(limits.consume).not.toHaveBeenCalled();
      expect(tx.staffInvitation.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(mail.sendAdminInvitation).not.toHaveBeenCalled();
    }
  });

  it('keeps the new link when the email fails, and never logs the address or the token', async () => {
    const { service, mail, logger } = setup();
    mail.sendAdminInvitation.mockRejectedValue(new Error('SMTP down'));

    const result = await service.resend('admin-1', context);

    expect(result.invitationSent).toBe(false);
    const logged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
    ]);
    expect(logged).toContain('admin-1');
    expect(logged).not.toContain(input.email);
    expect(logged).not.toContain(emailedToken(mail));
  });
});

