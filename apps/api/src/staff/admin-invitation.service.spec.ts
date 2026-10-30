import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { hashToken } from '../auth/token.util';
import type { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminInvitationService,
  INVITATION_TTL_MS,
} from './admin-invitation.service';

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

function setup() {
  const tx = { user: { create: jest.fn().mockResolvedValue(created) } };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('$argon2id$unusable') };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const mail = { sendAdminInvitation: jest.fn().mockResolvedValue(undefined) };
  const config = { get: () => 'http://localhost:3001' };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new AdminInvitationService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    audit as unknown as AuditService,
    mail as unknown as MailService,
    config as unknown as ConfigService<Env, true>,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, passwords, audit, mail, logger };
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
        /^http:\/\/localhost:3001\/staff\/accept-invite\?token=/,
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
