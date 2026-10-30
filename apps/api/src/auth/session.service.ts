import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Prisma, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenService,
} from './access-token.service';
import type { Audience } from './access-token.service';
import type { LoginInput } from './auth.schemas';
import { LoginAttemptsService } from './login-attempts.service';
import { PasswordService } from './password.service';
import { generateToken, hashToken } from './token.util';

const HOUR_MS = 60 * 60 * 1000;
// How long a sign-in lasts in total. After that the password is needed again,
// and for staff a code too. Staff access is powerful, so it lasts one working day.
const SESSION_TTL_MS: Record<Audience, number> = {
  customer: 30 * 24 * HOUR_MS,
  staff: 12 * HOUR_MS,
};
// The roles each audience is for. Each sign-in path accepts only its own
// roles, so a session's audience always follows from its user's role.
const ROLES: Record<Audience, UserRole[]> = {
  customer: ['CUSTOMER'],
  staff: ['ADMIN', 'SUPER_USER'],
};
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
  | 'wrong_audience'
  | 'session_ended'
  | 'token_reused'
  | 'account_not_allowed';

// What a failed refresh logs. Never the token itself.
interface RefreshContext {
  audience: Audience;
  userId?: string;
  sessionId?: string;
}

export interface TokenPair {
  accessToken: string;
  tokenType: 'Bearer';
  // Seconds until the access token expires.
  expiresIn: number;
  refreshToken: string;
}

// Who may use a session of this audience: an active account with one of its
// roles. Staff must also have MFA set up.
function liveUser(audience: Audience): Prisma.UserWhereInput {
  const user: Prisma.UserWhereInput = {
    role: { in: ROLES[audience] },
    status: 'ACTIVE',
  };
  return audience === 'staff'
    ? { ...user, mfaEnabledAt: { not: null } }
    : user;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly attempts: LoginAttemptsService,
    @InjectPinoLogger(SessionService.name) private readonly logger: PinoLogger,
  ) {}

  // The customer login. Staff have their own, which also asks for a code.
  async login(input: LoginInput, ip: string): Promise<TokenPair> {
    // While too many recent attempts failed, refuse before any password work.
    await this.attempts.check(input.email, ip);

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
        input,
        ip,
        user?.id,
      );
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      return this.loginFailed('wrong_password', input, ip, user.id);
    }
    // Same answer as a wrong password, so login never reveals which emails are registered.
    if (!user.emailVerifiedAt) {
      return this.loginFailed('email_not_verified', input, ip, user.id);
    }
    // Said only after the correct password, which nobody else can set for this account.
    if (user.status !== 'ACTIVE') {
      this.logFailure('account_disabled', user.id);
      throw new ForbiddenException({
        message: 'This account is disabled.',
        code: 'ACCOUNT_DISABLED',
      });
    }

    await this.attempts.succeeded(input.email, ip);
    return this.start(user.id, 'customer');
  }

  // Starts a session for someone a login has fully checked. Only the hash of
  // the refresh token is stored. The raw token goes to the client once.
  async start(userId: string, audience: Audience): Promise<TokenPair> {
    const { token: refreshToken, tokenHash } = generateToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS[audience]),
        refreshTokens: { create: { tokenHash } },
      },
      select: { id: true },
    });
    this.logger.info({ userId, sessionId: session.id, audience }, 'Signed in');
    return this.issueTokens(userId, session.id, refreshToken, audience);
  }

  // Swaps a refresh token for a new pair. Each refresh token works only once,
  // and only on the sign-in path (audience) it was issued for.
  async refresh(
    refreshToken: string,
    audience: Audience = 'customer',
  ): Promise<TokenPair> {
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
            user: {
              select: { id: true, role: true, status: true, mfaEnabledAt: true },
            },
          },
        },
      },
    });
    if (!record) {
      throw this.refreshFailure('unknown_token', { audience });
    }
    const { session } = record;
    const { user } = session;
    const context = { audience, userId: user.id, sessionId: session.id };

    // A token from the other sign-in path: not ours to swap or to end.
    if (!ROLES[audience].includes(user.role)) {
      throw this.refreshFailure('wrong_audience', context);
    }
    // A token that was already swapped came back, so someone has a copy of it.
    // We cannot tell the thief from the owner, so the whole session ends.
    if (record.usedAt) {
      await this.revokeSession(session.id);
      throw this.refreshFailure('token_reused', context);
    }
    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw this.refreshFailure('session_ended', context);
    }
    // A disabled account, or staff without MFA, ends the session for good.
    // The same rule as liveUser(), which every request checks.
    if (
      user.status !== 'ACTIVE' ||
      (audience === 'staff' && !user.mfaEnabledAt)
    ) {
      await this.revokeSession(session.id);
      throw this.refreshFailure('account_not_allowed', context);
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
      throw this.refreshFailure('token_reused', context);
    }
    this.logger.debug(context, 'Tokens refreshed');
    return this.issueTokens(user.id, session.id, next.token, audience);
  }

  // Always succeeds, so the answer never tells whether the token was valid.
  // A token from the other sign-in path is ignored like an unknown one.
  async logout(
    refreshToken: string,
    audience: Audience = 'customer',
  ): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      select: {
        sessionId: true,
        session: { select: { userId: true, user: { select: { role: true } } } },
      },
    });
    if (record && ROLES[audience].includes(record.session.user.role)) {
      await this.revokeSession(record.sessionId);
      this.logger.info(
        {
          userId: record.session.userId,
          sessionId: record.sessionId,
          audience,
        },
        'Signed out',
      );
    }
  }

  // Checked on every authenticated request, so logout, reuse detection,
  // disabled accounts and role changes take effect at once. While the session
  // is live, returns its user's current role; otherwise null.
  async liveSessionRole(
    userId: string,
    sessionId: string,
    audience: Audience = 'customer',
  ): Promise<UserRole | null> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: liveUser(audience),
      },
      select: { user: { select: { role: true } } },
    });
    return session?.user.role ?? null;
  }

  private async issueTokens(
    userId: string,
    sessionId: string,
    refreshToken: string,
    audience: Audience,
  ): Promise<TokenPair> {
    const accessToken = await this.accessTokens.sign(
      { id: userId, sessionId },
      audience,
    );
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
  // a limit answers 429 instead.
  private async loginFailed(
    reason: LoginFailure,
    input: LoginInput,
    ip: string,
    userId?: string,
  ): Promise<never> {
    this.logFailure(reason, userId);
    await this.attempts.failed(input.email, ip, userId);
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
    context: RefreshContext,
  ): UnauthorizedException {
    // Unknown and ended tokens are normal. Anything else may mean a stolen token.
    if (reason === 'unknown_token' || reason === 'session_ended') {
      this.logger.info({ ...context, reason }, 'Token refresh failed');
    } else {
      this.logger.warn({ ...context, reason }, 'Token refresh failed');
    }
    return new UnauthorizedException(INVALID_REFRESH_TOKEN);
  }
}
