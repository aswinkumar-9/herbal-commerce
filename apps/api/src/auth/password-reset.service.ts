import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import type { ResetPasswordInput } from './auth.schemas';
import { emailAndIpKey } from './login-limits';
import { PasswordService } from './password.service';
import { generateToken, hashToken } from './token.util';

// A reset link is powerful, so it lives only briefly.
const RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_ACCEPTED =
  'If this email address has an account, we have sent a link to choose a new password. Please check your inbox.';
const INVALID_LINK = 'Invalid or expired reset link';
const PASSWORD_CHANGED =
  'Your password has been changed. Please sign in with your new password.';

type ResetFailure =
  | 'unknown_token'
  | 'already_used'
  | 'expired'
  | 'not_allowed'
  | 'lost_race';

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
    private readonly limits: RateLimitService,
    @InjectPinoLogger(PasswordResetService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Always the same answer, and just as fast for unknown emails as for real
  // ones: the lookup, the link and the email happen after the response.
  async requestReset(email: string): Promise<{ message: string }> {
    // Counted for every address, known or not, so a 429 reveals nothing.
    await this.limits.consume('emailsToAddress', email);
    void this.sendResetLink(email);
    return { message: GENERIC_ACCEPTED };
  }

  // Sets a new password with the token from the email link. Every session of
  // the account ends, so whoever knew the old password is signed out.
  async resetPassword(
    input: ResetPasswordInput,
    ip: string,
  ): Promise<{ message: string }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: {
            email: true,
            fullName: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
          },
        },
      },
    });
    // Checked before hashing, so a made-up token costs no password work.
    if (!record) {
      throw this.resetFailure('unknown_token');
    }
    if (record.usedAt) {
      throw this.resetFailure('already_used', record.userId);
    }
    if (record.expiresAt <= new Date()) {
      throw this.resetFailure('expired', record.userId);
    }
    const { user } = record;
    if (user.role !== 'CUSTOMER' || user.status !== 'ACTIVE') {
      throw this.resetFailure('not_allowed', record.userId);
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    const now = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: if two requests send the same link, only one wins.
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claim.count === 0) {
        return false;
      }
      await tx.user.update({
        where: { id: record.userId },
        // The link proves the owner controls this inbox, so the email counts
        // as verified. This also ends a sign-up made by someone else.
        data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? now },
      });
      // Every session ends: whoever knew the old password is signed out.
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Any other unused link for this account stops working too.
      await tx.passwordResetToken.deleteMany({
        where: { userId: record.userId, usedAt: null },
      });
      return true;
    });
    if (!claimed) {
      throw this.resetFailure('lost_race', record.userId);
    }

    // The owner proved who they are, so failed guesses must not keep them out.
    await Promise.all([
      this.limits.reset('loginFailuresByEmail', user.email),
      this.limits.reset(
        'loginFailuresByEmailAndIp',
        emailAndIpKey(user.email, ip),
      ),
    ]);
    this.logger.info(
      { userId: record.userId },
      'Password reset: new password set, all sessions ended',
    );
    void this.notifyPasswordChanged(user.email, user.fullName, record.userId);
    return { message: PASSWORD_CHANGED };
  }

  // Runs in the background, so it must never throw.
  private async sendResetLink(email: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true, fullName: true, role: true, status: true },
      });
      // Staff reset through their own path; a disabled account cannot sign in.
      if (!user || user.role !== 'CUSTOMER' || user.status !== 'ACTIVE') {
        this.logger.info(
          { userId: user?.id, reason: user ? 'not_allowed' : 'unknown_account' },
          'No password reset link sent',
        );
        return;
      }

      // Only the hash is stored. The raw token goes into the email once.
      const { token, tokenHash } = generateToken();
      await this.prisma.$transaction([
        // A new link replaces any older unused one.
        this.prisma.passwordResetToken.deleteMany({
          where: { userId: user.id, usedAt: null },
        }),
        this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + RESET_TTL_MS),
          },
        }),
      ]);
      await this.mail.sendPasswordResetEmail(
        email,
        user.fullName,
        this.resetUrl(token),
      );
      this.logger.info({ userId: user.id }, 'Password reset link sent');
    } catch (error) {
      // Only the error name: messages can contain email addresses.
      this.logger.warn(
        { errorName: error instanceof Error ? error.name : 'unknown' },
        'Failed to send a password reset link',
      );
    }
  }

  // Runs in the background, so a mail failure can never undo a reset.
  private async notifyPasswordChanged(
    email: string,
    fullName: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.mail.sendPasswordChangedNotice(email, fullName);
    } catch (error) {
      this.logger.warn(
        { errorName: error instanceof Error ? error.name : 'unknown', userId },
        'Failed to send the password changed notice',
      );
    }
  }

  // Logs the reason and builds the one answer every refused link gets.
  private resetFailure(
    reason: ResetFailure,
    userId?: string,
  ): BadRequestException {
    this.logger.info({ userId, reason }, 'Password reset refused');
    return new BadRequestException(INVALID_LINK);
  }

  private resetUrl(token: string): string {
    const base = this.config.get('WEB_BASE_URL', { infer: true });
    return `${base}/reset-password?token=${encodeURIComponent(token)}`;
  }
}
