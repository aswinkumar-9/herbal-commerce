import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { generateToken } from './token.util';

// A reset link is powerful, so it lives only briefly.
const RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_ACCEPTED =
  'If this email address has an account, we have sent a link to choose a new password. Please check your inbox.';

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
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

  private resetUrl(token: string): string {
    const base = this.config.get('WEB_BASE_URL', { infer: true });
    return `${base}/reset-password?token=${encodeURIComponent(token)}`;
  }
}
