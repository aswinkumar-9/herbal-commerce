import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import type { RegisterInput } from './auth.schemas';
import { PasswordService } from './password.service';
import { generateToken, hashToken } from './token.util';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const INVALID_LINK = 'Invalid or expired verification link';
const GENERIC_ACCEPTED =
  'If this email address can be used, we have sent you a message. Please check your inbox.';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
    private readonly limits: RateLimitService,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {}

  async register(input: RegisterInput): Promise<{ message: string }> {
    // Registering always emails this address (a link or an "account exists"
    // notice), so it counts against the address's limit. Counted whether or
    // not an account exists, and before any hashing.
    await this.limits.consume('emailsToAddress', input.email);
    // Hash first on every path, so new and existing emails take a similar time.
    const passwordHash = await this.passwords.hash(input.password);

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      await this.notifyAccountExists(input.email);
      return { message: GENERIC_ACCEPTED };
    }

    const { token, tokenHash } = generateToken();
    let userId: string;
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: 'CUSTOMER', // set by the server, never taken from the request
          emailVerificationTokens: {
            create: {
              tokenHash,
              expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
            },
          },
        },
        select: { id: true },
      });
      userId = user.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Two simultaneous registrations for the same email: treat as existing.
        await this.notifyAccountExists(input.email);
        return { message: GENERIC_ACCEPTED };
      }
      throw error;
    }

    await this.safeSend(
      () =>
        this.mail.sendVerificationEmail(
          input.email,
          input.fullName,
          this.verificationUrl(token),
        ),
      'verification email',
      userId,
    );
    return { message: GENERIC_ACCEPTED };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const tokenHash = hashToken(token);
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!record) {
      throw new BadRequestException(INVALID_LINK);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only one request can ever consume a token.
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(INVALID_LINK);
      }
      await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
    });
    return { message: 'Email address verified.' };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    // Counted for every address, known or not, so a 429 reveals nothing.
    await this.limits.consume('emailsToAddress', email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, emailVerifiedAt: true },
    });

    if (user && !user.emailVerifiedAt) {
      const recent = await this.prisma.emailVerificationToken.findFirst({
        where: {
          userId: user.id,
          createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (!recent) {
        const { token, tokenHash } = generateToken();
        await this.prisma.$transaction([
          this.prisma.emailVerificationToken.deleteMany({
            where: { userId: user.id, usedAt: null },
          }),
          this.prisma.emailVerificationToken.create({
            data: {
              userId: user.id,
              tokenHash,
              expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
            },
          }),
        ]);
        await this.safeSend(
          () =>
            this.mail.sendVerificationEmail(
              email,
              user.fullName,
              this.verificationUrl(token),
            ),
          'verification email',
          user.id,
        );
      }
    }
    return { message: GENERIC_ACCEPTED };
  }

  // The signed-in user's own account. Never includes the password hash.
  getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });
  }

  private verificationUrl(token: string): string {
    const base = this.config.get('WEB_BASE_URL', { infer: true });
    return `${base}/verify-email?token=${encodeURIComponent(token)}`;
  }

  private notifyAccountExists(email: string): Promise<void> {
    return this.safeSend(
      () => this.mail.sendAccountExistsNotice(email),
      'account-exists notice',
    );
  }

  // A mail failure must never fail the request or leak whether an account exists.
  private async safeSend(
    send: () => Promise<void>,
    what: string,
    userId?: string,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      // Log only the error name: messages can contain email addresses.
      this.logger.warn(
        { errorName: error instanceof Error ? error.name : 'unknown', userId },
        `Failed to send ${what}`,
      );
    }
  }
}
