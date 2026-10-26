import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import type { RateLimitName } from '../rate-limit/rate-limits';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenService,
} from './access-token.service';
import type { LoginInput } from './auth.schemas';
import { PasswordService } from './password.service';
import { generateToken, hashToken } from './token.util';

// A sign-in lasts 30 days in total. After that the password is needed again.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVALID_CREDENTIALS = 'Invalid email or password';
// The same answer for every failed refresh; the reason goes to the log only.
const INVALID_REFRESH_TOKEN = 'Invalid refresh token';

type LoginFailure =
  | 'unknown_account'
  | 'not_customer'
  | 'wrong_password'
  | 'email_not_verified'
  | 'account_disabled';

type RefreshFailure =
  | 'unknown_token'
  | 'session_ended'
  | 'token_reused'
  | 'account_not_allowed';

// A failed-login limit and the key it counts.
type FailureCounter = [RateLimitName, string];

export interface TokenPair {
  accessToken: string;
  tokenType: 'Bearer';
  // Seconds until the access token expires.
  expiresIn: number;
  refreshToken: string;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly limits: RateLimitService,
    @InjectPinoLogger(SessionService.name) private readonly logger: PinoLogger,
  ) {}

  async login(input: LoginInput, ip: string): Promise<TokenPair> {
    const emailAndIp = `${ip}|${input.email}`;
    const counters: FailureCounter[] = [
      // One person guessing one account's password.
      ['loginFailuresByEmailAndIp', emailAndIp],
      // Many machines guessing one account's password.
      ['loginFailuresByEmail', input.email],
      // One machine trying many accounts.
      ['loginFailuresByIp', ip],
    ];
    // While too many recent attempts failed, refuse before any password work.
    await Promise.all(
      counters.map(([name, key]) => this.limits.check(name, key)),
    );

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        role: true,
        status: true,
        passwordHash: true,
        emailVerifiedAt: true,
      },
    });

    // Staff sign in through their own path (with MFA), so here they count as unknown.
    if (!user || user.role !== 'CUSTOMER') {
      await this.passwords.verifyDummy(input.password);
      return this.loginFailed(
        user ? 'not_customer' : 'unknown_account',
        counters,
        user?.id,
      );
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      return this.loginFailed('wrong_password', counters, user.id);
    }
    // Same answer as a wrong password, so login never reveals which emails are registered.
    if (!user.emailVerifiedAt) {
      return this.loginFailed('email_not_verified', counters, user.id);
    }
    // Said only after the correct password, which nobody else can set for this account.
    if (user.status !== 'ACTIVE') {
      this.logFailure('account_disabled', user.id);
      throw new ForbiddenException({
        message: 'This account is disabled.',
        code: 'ACCOUNT_DISABLED',
      });
    }

    // The right password: this person on this IP starts again from zero.
    // The per-email and per-IP counters keep counting.
    await this.limits.reset('loginFailuresByEmailAndIp', emailAndIp);

    // Only the hash is stored. The raw refresh token goes to the client once.
    const { token: refreshToken, tokenHash } = generateToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        refreshTokens: { create: { tokenHash } },
      },
      select: { id: true },
    });
    this.logger.info(
      { userId: user.id, sessionId: session.id },
      'Customer signed in',
    );
    return this.issueTokens(user.id, session.id, refreshToken);
  }

  // Swaps a refresh token for a new pair. Each refresh token works only once.
  async refresh(refreshToken: string): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      select: {
        id: true,
        usedAt: true,
        session: {
          select: {
            id: true,
            expiresAt: true,
            revokedAt: true,
            user: { select: { id: true, role: true, status: true } },
          },
        },
      },
    });
    if (!record) {
      throw this.refreshFailure('unknown_token');
    }
    const { session } = record;
    const ids = { userId: session.user.id, sessionId: session.id };

    // A token that was already swapped came back, so someone has a copy of it.
    // We cannot tell the thief from the owner, so the whole session ends.
    if (record.usedAt) {
      await this.revokeSession(session.id);
      throw this.refreshFailure('token_reused', ids);
    }
    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw this.refreshFailure('session_ended', ids);
    }
    // A disabled account or a role change ends the session for good.
    if (session.user.role !== 'CUSTOMER' || session.user.status !== 'ACTIVE') {
      await this.revokeSession(session.id);
      throw this.refreshFailure('account_not_allowed', ids);
    }

    const next = generateToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: if two requests send the same token, only one wins.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) {
        return false;
      }
      await tx.refreshToken.create({
        data: { sessionId: session.id, tokenHash: next.tokenHash },
      });
      return true;
    });
    if (!rotated) {
      // Another request used this token first, so this is a second use.
      await this.revokeSession(session.id);
      throw this.refreshFailure('token_reused', ids);
    }
    this.logger.debug(ids, 'Tokens refreshed');
    return this.issueTokens(session.user.id, session.id, next.token);
  }

  // Always succeeds, so the answer never tells whether the token was valid.
  async logout(refreshToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      select: { sessionId: true, session: { select: { userId: true } } },
    });
    if (record) {
      await this.revokeSession(record.sessionId);
      this.logger.info(
        { userId: record.session.userId, sessionId: record.sessionId },
        'Customer signed out',
      );
    }
  }

  // Checked on every authenticated request, so logout, reuse detection and
  // disabled accounts take effect at once.
  async isActive(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { role: 'CUSTOMER', status: 'ACTIVE' },
      },
      select: { id: true },
    });
    return session !== null;
  }

  private async issueTokens(
    userId: string,
    sessionId: string,
    refreshToken: string,
  ): Promise<TokenPair> {
    const accessToken = await this.accessTokens.sign({ id: userId, sessionId });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
    };
  }

  // Ends a session: every refresh token in it stops working at once.
  private async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Logs the failure, counts it, and answers 401. The attempt that goes over
  // a limit answers 429 instead. Unknown emails count too, so a 429 never
  // reveals whether an account exists.
  private async loginFailed(
    reason: LoginFailure,
    counters: FailureCounter[],
    userId?: string,
  ): Promise<never> {
    this.logFailure(reason, userId);
    try {
      await Promise.all(
        counters.map(([name, key]) => this.limits.consume(name, key)),
      );
    } catch (error) {
      if (error instanceof RetryLaterException) {
        this.logger.warn({ userId }, 'Too many failed sign-ins: refusing for a while');
      }
      throw error;
    }
    throw new UnauthorizedException(INVALID_CREDENTIALS);
  }

  // The reason goes to the log only, never to the client. Emails are never logged.
  private logFailure(reason: LoginFailure, userId?: string): void {
    // A staff email used on the customer path deserves a closer look.
    if (reason === 'not_customer') {
      this.logger.warn({ userId, reason }, 'Customer sign-in failed');
    } else {
      this.logger.info({ userId, reason }, 'Customer sign-in failed');
    }
  }

  // Logs the reason and builds the one answer every failed refresh gets.
  private refreshFailure(
    reason: RefreshFailure,
    ids: { userId?: string; sessionId?: string } = {},
  ): UnauthorizedException {
    // A reused token or a blocked account may mean a stolen token.
    if (reason === 'token_reused' || reason === 'account_not_allowed') {
      this.logger.warn({ ...ids, reason }, 'Token refresh failed');
    } else {
      this.logger.info({ ...ids, reason }, 'Token refresh failed');
    }
    return new UnauthorizedException(INVALID_REFRESH_TOKEN);
  }
}
