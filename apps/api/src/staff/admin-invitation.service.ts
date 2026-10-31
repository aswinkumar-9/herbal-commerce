import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { generateToken, hashToken } from '../auth/token.util';
import { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { ADMIN_NOT_FOUND } from './admins.service';
import type { AcceptInviteInput, AdminInviteInput } from './staff.schemas';

// People do not always read their email at once, so an invitation waits a
// few days. It still works only once.
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const EMAIL_TAKEN = 'An account with this email address already exists.';
const INVALID_INVITATION = 'Invalid or expired invitation link';
const PASSWORD_SET =
  'Your password has been set. Before you can sign in, a developer will set up an authenticator app on your phone with you.';
const ALREADY_ACCEPTED = 'This Admin has already accepted the invitation.';
const ENABLE_FIRST = 'Enable this Admin before inviting them again.';

type AcceptFailure =
  | 'unknown_token'
  | 'already_used'
  | 'expired'
  | 'not_allowed'
  | 'lost_race';

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
    private readonly limits: RateLimitService,
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

  // Public: the Admin has no password yet. The link proves they control the
  // invited inbox, and it works only once.
  async accept(
    input: AcceptInviteInput,
    context: AuditContext,
  ): Promise<{ message: string }> {
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { role: true, status: true } },
      },
    });
    // Checked before hashing, so a made-up token costs no password work.
    if (!invitation) {
      throw this.acceptFailure('unknown_token');
    }
    const { userId, user } = invitation;
    if (invitation.usedAt) {
      throw this.acceptFailure('already_used', userId);
    }
    if (invitation.expiresAt <= new Date()) {
      throw this.acceptFailure('expired', userId);
    }
    // A disabled Admin stays out, even with a valid link.
    if (user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
      throw this.acceptFailure('not_allowed', userId);
    }

    const passwordHash = await this.passwords.hash(input.password);
    const now = new Date();
    const accepted = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: if two requests send the same link, only one wins.
      const claim = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claim.count === 0) {
        return false;
      }
      await tx.user.update({
        where: { id: userId },
        // The link proves the Admin controls this inbox, so the email
        // counts as verified.
        data: { passwordHash, emailVerifiedAt: now },
      });
      // Whenever a password is set, every session of the account ends.
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Any other unused invitation for this Admin stops working too.
      await tx.staffInvitation.deleteMany({
        where: { userId, usedAt: null },
      });
      // Nobody is signed in here: the Admin is the one acting.
      await this.audit.record(tx, {
        ...context,
        actorId: userId,
        action: 'admin.invite_accepted',
        targetType: 'user',
        targetId: userId,
      });
      return true;
    });
    if (!accepted) {
      throw this.acceptFailure('lost_race', userId);
    }

    this.logger.info({ userId }, 'Admin invitation accepted: password set');
    return { message: PASSWORD_SET };
  }

  // Sends a pending Admin a new link. Every older link stops working, so
  // only the newest one in the inbox counts.
  async resend(id: string, context: AuditContext): Promise<InvitedAdmin> {
    const { token, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const now = new Date();

    const admin = await this.prisma.$transaction(async (tx) => {
      // The old links go first. Like accept(), this takes the invitation
      // rows before the Admin's row, so the two can never wait for each
      // other. An Admin who accepts an old link at this moment either
      // finishes first, or finds the link gone.
      await tx.staffInvitation.deleteMany({
        where: { userId: id, usedAt: null },
      });
      // Atomic: the Admin must still be pending and active.
      const pending = await tx.user.updateMany({
        where: { id, role: 'ADMIN', status: 'ACTIVE', emailVerifiedAt: null },
        data: { updatedAt: now },
      });
      if (pending.count === 0) {
        // Thrown inside the transaction, so the delete above is undone.
        const found = await tx.user.findFirst({
          where: { id, role: 'ADMIN' },
          select: { emailVerifiedAt: true },
        });
        if (!found) {
          throw new NotFoundException(ADMIN_NOT_FOUND);
        }
        throw new ConflictException(
          found.emailVerifiedAt ? ALREADY_ACCEPTED : ENABLE_FIRST,
        );
      }
      const pendingAdmin = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { id: true, email: true, fullName: true },
      });
      // Every email to one address counts, as for customers (ADR 0009).
      // Over the limit, the 429 undoes this transaction too.
      await this.limits.consume('emailsToAddress', pendingAdmin.email);
      await tx.staffInvitation.create({
        data: { userId: id, tokenHash, expiresAt },
      });
      await this.audit.record(tx, {
        ...context,
        action: 'admin.invitation_resent',
        targetType: 'user',
        targetId: id,
        after: { invitationExpiresAt: expiresAt },
      });
      return pendingAdmin;
    });

    const invitationSent = await this.sendInvitation(admin, token);
    this.logger.info(
      { userId: id, actorId: context.actorId, invitationSent },
      'Admin invitation sent again',
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

  // Logs the reason and builds the one answer every refused link gets.
  private acceptFailure(
    reason: AcceptFailure,
    userId?: string,
  ): BadRequestException {
    this.logger.info({ userId, reason }, 'Admin invitation refused');
    return new BadRequestException(INVALID_INVITATION);
  }

  private invitationUrl(token: string): string {
    const base = this.config.get('WEB_BASE_URL', { infer: true });
    return `${base}/staff/accept-invite?token=${encodeURIComponent(token)}`;
  }
}
