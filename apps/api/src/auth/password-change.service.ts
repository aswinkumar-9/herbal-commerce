import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ChangePasswordInput } from './auth.schemas';
import { LoginAttemptsService } from './login-attempts.service';
import { PasswordService } from './password.service';

const WRONG_PASSWORD = 'The current password is wrong.';
const PASSWORD_CHANGED =
  'Your password has been changed. Please sign in again with your new password.';

// A signed-in customer changes their own password (ADR 0018). It ends like a
// reset (ADR 0010): every session ends, and a notice goes to the inbox.
@Injectable()
export class PasswordChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly attempts: LoginAttemptsService,
    private readonly mail: MailService,
    @InjectPinoLogger(PasswordChangeService.name)
    private readonly logger: PinoLogger,
  ) {}

  async change(
    userId: string,
    input: ChangePasswordInput,
    ip: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, fullName: true, passwordHash: true },
    });
    if (!user) {
      // The account was deleted after the token was issued.
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // The current password is guessed against the same limits as the login,
    // so a stolen access token gives no faster way to find it.
    await this.attempts.check(user.email, ip);
    const isRight = await this.passwords.verify(
      user.passwordHash,
      input.currentPassword,
    );
    if (!isRight) {
      this.logger.warn(
        { userId, reason: 'wrong_password' },
        'Password change refused',
      );
      await this.attempts.failed(user.email, ip, userId);
      throw new BadRequestException(WRONG_PASSWORD);
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // Every session ends, this one too: whoever knew the old password is
      // signed out, and the owner signs in again with the new one.
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // A reset link asked for before the change must not undo it.
      await tx.passwordResetToken.deleteMany({
        where: { userId, usedAt: null },
      });
    });

    await this.attempts.succeeded(user.email, ip);
    this.logger.info({ userId }, 'Password changed: all sessions ended');
    void this.notifyPasswordChanged(user.email, user.fullName, userId);
    return { message: PASSWORD_CHANGED };
  }

  // Runs in the background, so a mail failure can never undo the change.
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
}
