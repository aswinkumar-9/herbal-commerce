import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenService,
} from './access-token.service';
import type { LoginInput } from './auth.schemas';
import { PasswordService } from './password.service';
import { generateToken } from './token.util';

// A sign-in lasts 30 days in total. After that the password is needed again.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVALID_CREDENTIALS = 'Invalid email or password';

type LoginFailure =
  | 'unknown_account'
  | 'not_customer'
  | 'wrong_password'
  | 'email_not_verified'
  | 'account_disabled';

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
    @InjectPinoLogger(SessionService.name) private readonly logger: PinoLogger,
  ) {}

  async login(input: LoginInput): Promise<TokenPair> {
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
      this.logFailure(user ? 'not_customer' : 'unknown_account', user?.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      this.logFailure('wrong_password', user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Same answer as a wrong password, so login never reveals which emails are registered.
    if (!user.emailVerifiedAt) {
      this.logFailure('email_not_verified', user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Said only after the correct password, which nobody else can set for this account.
    if (user.status !== 'ACTIVE') {
      this.logFailure('account_disabled', user.id);
      throw new ForbiddenException({
        message: 'This account is disabled.',
        code: 'ACCOUNT_DISABLED',
      });
    }

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

  // The reason goes to the log only, never to the client. Emails are never logged.
  private logFailure(reason: LoginFailure, userId?: string): void {
    // A staff email used on the customer path deserves a closer look.
    if (reason === 'not_customer') {
      this.logger.warn({ userId, reason }, 'Customer sign-in failed');
    } else {
      this.logger.info({ userId, reason }, 'Customer sign-in failed');
    }
  }
}
