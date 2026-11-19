import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { PasswordService } from '../auth/password.service';
import { generateToken } from '../auth/token.util';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { codeRefused, NO_KEY_YET } from './admin-invitation.service';
import { ADMIN_NOT_FOUND } from './admins.service';
import { SETUP_LINK_TTL_MS, SetupLinksService } from './setup-links.service';
import type { ResetAuthenticatorInput } from './staff.schemas';
import { StaffMfaService } from './staff-mfa.service';

export const ACCEPT_FIRST =
  'This Admin has not accepted the invitation yet: send the invitation again.';
export const ENABLE_FIRST =
  'Enable this Admin before resetting their authenticator app.';
// One answer for a wrong password or a wrong code, as at sign-in, so it
// never tells which was right.
export const WRONG_PASSWORD_OR_CODE = 'Invalid password or code';
const ALL_SET = 'Your authenticator app is set. Sign in with it.';

export interface AuthenticatorReset {
  id: string;
  email: string;
  fullName: string;
  // When the emailed link stops working.
  authenticatorLinkExpiresAt: Date;
  // False if the email could not be sent: reset it again to send a new one.
  emailSent: boolean;
}

// An Admin who lost their phone (ADR 0038). A Super User resets the
// authenticator app: it stops working at once, every session ends, and the
// Admin is emailed a link. With it, their own password and a code, they set
// up the app again. The developer command stays for Super Users (ADR 0013).
@Injectable()
export class AuthenticatorResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: SetupLinksService,
    private readonly mfa: StaffMfaService,
    private readonly passwords: PasswordService,
    private readonly attempts: LoginAttemptsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly limits: RateLimitService,
    @InjectPinoLogger(AuthenticatorResetService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Only for Super Users: the route is @SuperUserOnly(). Only an active
  // Admin who accepted the invitation: a pending one gets the invitation
  // again instead, and a disabled one is enabled first.
  async reset(id: string, context: AuditContext): Promise<AuthenticatorReset> {
    const { token, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_MS);
    const now = new Date();

    const admin = await this.prisma.$transaction(async (tx) => {
      // The old links go first, in the same order as accepting a link, so
      // the two never wait for each other.
      await tx.staffInvitation.deleteMany({
        where: { userId: id, usedAt: null },
      });
      // Atomic: still an active Admin who accepted the invitation. The old
      // key stops working at once.
      const cleared = await tx.user.updateMany({
        where: {
          id,
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerifiedAt: { not: null },
        },
        data: { mfaSecret: null, mfaEnabledAt: null, mfaLastUsedStep: null },
      });
      if (cleared.count === 0) {
        // Thrown inside the transaction, so the delete above is undone.
        const found = await tx.user.findFirst({
          where: { id, role: 'ADMIN' },
          select: { status: true, emailVerifiedAt: true },
        });
        if (!found) {
          throw new NotFoundException(ADMIN_NOT_FOUND);
        }
        throw new ConflictException(
          found.status === 'DISABLED' ? ENABLE_FIRST : ACCEPT_FIRST,
        );
      }
      // Whoever has the lost phone, and was signed in, must go.
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      const resetAdmin = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { id: true, email: true, fullName: true },
      });
      // Every email to one address counts (ADR 0009). Over the limit, the
      // 429 undoes this transaction too.
      await this.limits.consume('emailsToAddress', resetAdmin.email);
      await tx.staffInvitation.create({
        data: {
          userId: id,
          purpose: 'AUTHENTICATOR_RESET',
          tokenHash,
          expiresAt,
        },
      });
      await this.audit.record(tx, {
        ...context,
        action: 'admin.authenticator_reset',
        targetType: 'user',
        targetId: id,
        after: { authenticatorLinkExpiresAt: expiresAt },
      });
      return resetAdmin;
    });

    const emailSent = await this.send(admin, token);
    this.logger.info(
      { userId: id, actorId: context.actorId, emailSent },
      'Admin authenticator reset',
    );
    return { ...admin, authenticatorLinkExpiresAt: expiresAt, emailSent };
  }

  // Public: the Admin, signed out, sets up the app again with the link,
  // their own password and a code from the new key. Wrong passwords count
  // against the failed sign-in limits, as at sign-in.
  async complete(
    input: ResetAuthenticatorInput,
    context: AuditContext,
  ): Promise<{ message: string }> {
    const link = await this.links.usable(input.token, 'AUTHENTICATOR_RESET');
    const { userId, email, secret } = link;
    if (secret === null) {
      throw codeRefused(NO_KEY_YET);
    }
    const ip = context.ip ?? 'unknown';
    await this.attempts.check(email, ip);
    const stored = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    const now = new Date();
    const isRight = await this.passwords.verify(
      stored.passwordHash,
      input.password,
    );
    const step = isRight ? this.mfa.check(secret, input.code, now.getTime()) : null;
    if (step === null) {
      await this.attempts.failed(email, ip, userId);
      throw new UnauthorizedException(WRONG_PASSWORD_OR_CODE);
    }

    const done = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: if two requests send the same link, only one wins.
      const claim = await tx.staffInvitation.updateMany({
        where: { id: link.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claim.count === 0) {
        return false;
      }
      await tx.user.update({
        where: { id: userId },
        // The code just typed must not also work for signing in.
        data: {
          mfaSecret: this.mfa.seal(secret, userId),
          mfaEnabledAt: now,
          mfaLastUsedStep: step,
        },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.staffInvitation.deleteMany({
        where: { userId, usedAt: null },
      });
      await this.audit.record(tx, {
        ...context,
        actorId: userId,
        action: 'staff.mfa_set_up',
        targetType: 'user',
        targetId: userId,
        after: { mfaEnabled: true },
      });
      return true;
    });
    if (!done) {
      throw this.links.refused('AUTHENTICATOR_RESET', 'lost_race', userId);
    }
    await this.attempts.succeeded(email, ip);
    this.logger.info({ userId }, 'Admin authenticator set up again');
    return { message: ALL_SET };
  }

  // A failed email must not undo the reset, which is already saved.
  private async send(
    admin: { id: string; email: string; fullName: string },
    token: string,
  ): Promise<boolean> {
    try {
      await this.mail.sendAuthenticatorReset(
        admin.email,
        admin.fullName,
        this.links.url('AUTHENTICATOR_RESET', token),
      );
      return true;
    } catch (error) {
      // Only the error name: messages can contain email addresses.
      this.logger.warn(
        {
          userId: admin.id,
          errorName: error instanceof Error ? error.name : 'unknown',
        },
        'Failed to send an authenticator reset',
      );
      return false;
    }
  }
}
