import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// How long data is kept once it is no longer needed (ADR 0011).
export const RETENTION = {
  // Ended sessions stay a while, for looking into incidents. Deleting a
  // session deletes its refresh tokens too.
  endedSessionDays: 30,
  // Reuse detection only needs recently used refresh tokens.
  usedRefreshTokenDays: 7,
  // Unverified sign-ups go away, which also frees the address for its real
  // owner if someone else registered it.
  unverifiedAccountDays: 7,
};

// How many rows of each kind one run deleted.
export interface PurgeResult {
  sessions: number;
  refreshTokens: number;
  verificationTokens: number;
  resetTokens: number;
  unverifiedAccounts: number;
}

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(RetentionService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Deletes everything past its retention period. Safe to run at any time,
  // and from several API instances at once: each step is a conditional delete.
  async purge(now = new Date()): Promise<PurgeResult> {
    const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const sessionsEndedBefore = daysAgo(RETENTION.endedSessionDays);

    const sessions = await this.prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: sessionsEndedBefore } },
          { revokedAt: { lt: sessionsEndedBefore } },
        ],
      },
    });
    const refreshTokens = await this.prisma.refreshToken.deleteMany({
      where: { usedAt: { lt: daysAgo(RETENTION.usedRefreshTokenDays) } },
    });
    const verificationTokens =
      await this.prisma.emailVerificationToken.deleteMany({
        where: { expiresAt: { lt: now } },
      });
    const resetTokens = await this.prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    // Customers only: staff accounts are managed by people, never by a timer.
    const unverifiedAccounts = await this.prisma.user.deleteMany({
      where: {
        role: 'CUSTOMER',
        emailVerifiedAt: null,
        createdAt: { lt: daysAgo(RETENTION.unverifiedAccountDays) },
      },
    });

    const result: PurgeResult = {
      sessions: sessions.count,
      refreshTokens: refreshTokens.count,
      verificationTokens: verificationTokens.count,
      resetTokens: resetTokens.count,
      unverifiedAccounts: unverifiedAccounts.count,
    };
    // Counts only: nothing personal goes into the log.
    this.logger.info(result, 'Retention cleanup finished');
    return result;
  }
}
