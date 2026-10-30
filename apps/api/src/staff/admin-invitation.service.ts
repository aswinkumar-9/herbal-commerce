import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { generateToken } from '../auth/token.util';
import { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminInviteInput } from './staff.schemas';

// People do not always read their email at once, so an invitation waits a
// few days. It still works only once.
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const EMAIL_TAKEN = 'An account with this email address already exists.';

export interface InvitedAdmin {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN';
  invitationExpiresAt: Date;
  // False if the email could not be sent: the Admin then needs a new one.
  invitationSent: boolean;
}

// Super Users invite Admins (ADR 0004, ADR 0015). The Admin chooses their own
// password from the emailed link, so nobody else ever knows it.
@Injectable()
export class AdminInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
    @InjectPinoLogger(AdminInvitationService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Only for Super Users: the route is @SuperUserOnly().
  async invite(
    input: AdminInviteInput,
    context: AuditContext,
  ): Promise<InvitedAdmin> {
    // Customers are never turned into staff: an Admin needs a new address.
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(EMAIL_TAKEN);
    }

    // Until the Admin chooses one, the account has a password nobody knows.
    const passwordHash = await this.passwords.hash(
      randomBytes(32).toString('base64url'),
    );
    // Only the hash is stored. The raw token goes into the email once.
    const { token, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    let admin: { id: string; email: string; fullName: string };
    try {
      admin = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            fullName: input.fullName,
            passwordHash,
            role: 'ADMIN',
            staffInvitations: { create: { tokenHash, expiresAt } },
          },
          select: { id: true, email: true, fullName: true },
        });
        // In the same transaction: no Admin without its audit entry.
        await this.audit.record(tx, {
          ...context,
          action: 'admin.invited',
          targetType: 'user',
          targetId: user.id,
          after: { email: user.email, fullName: user.fullName, role: 'ADMIN' },
        });
        return user;
      });
    } catch (error) {
      // Someone created the same email at the same moment.
      if (isUniqueViolation(error)) {
        throw new ConflictException(EMAIL_TAKEN);
      }
      throw error;
    }

    const invitationSent = await this.sendInvitation(admin, token);
    this.logger.info(
      { userId: admin.id, actorId: context.actorId, invitationSent },
      'Admin invited',
    );
    return {
      ...admin,
      role: 'ADMIN',
      invitationExpiresAt: expiresAt,
      invitationSent,
    };
  }

  // A failed email must not undo the invitation, which is already saved.
  private async sendInvitation(
    admin: { id: string; email: string; fullName: string },
    token: string,
  ): Promise<boolean> {
    try {
      await this.mail.sendAdminInvitation(
        admin.email,
        admin.fullName,
        this.invitationUrl(token),
      );
      return true;
    } catch (error) {
      // Only the error name: messages can contain email addresses.
      this.logger.warn(
        {
          userId: admin.id,
          errorName: error instanceof Error ? error.name : 'unknown',
        },
        'Failed to send an Admin invitation',
      );
      return false;
    }
  }

  private invitationUrl(token: string): string {
    const base = this.config.get('WEB_BASE_URL', { infer: true });
    return `${base}/staff/accept-invite?token=${encodeURIComponent(token)}`;
  }
}
