import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import type { TokenPair } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StaffLoginInput } from './staff.schemas';
import { StaffMfaService } from './staff-mfa.service';

// The one answer for every failed staff sign-in. Nobody can learn from it
// whether the email, the password or the code was wrong (ADR 0014).
const INVALID_STAFF_CREDENTIALS = 'Invalid email, password or code';

type StaffLoginFailure =
  | 'unknown_account'
  | 'not_staff'
  | 'wrong_password'
  | 'account_disabled'
  | 'mfa_not_set_up'
  | 'wrong_code'
  | 'code_check_failed';

// The staff login: the password and an authenticator code, always together.
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mfa: StaffMfaService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptsService,
    @InjectPinoLogger(StaffAuthService.name)
    private readonly logger: PinoLogger,
  ) {}

  async login(input: StaffLoginInput, ip: string): Promise<TokenPair> {
    // While too many recent attempts failed, refuse before any password work.
    await this.attempts.check(input.email, ip);

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        role: true,
        status: true,
        passwordHash: true,
        mfaEnabledAt: true,
      },
    });

    // Customers sign in through their own path, so here they count as unknown.
    if (!user || user.role === 'CUSTOMER') {
      await this.passwords.verifyDummy(input.password);
      return this.failed(
        user ? 'not_staff' : 'unknown_account',
        input,
        ip,
        user?.id,
      );
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      return this.failed('wrong_password', input, ip, user.id);
    }
    // Unlike customers, staff are not told that their account is disabled:
    // that would confirm the password to anyone who has guessed it.
    if (user.status !== 'ACTIVE') {
      return this.failed('account_disabled', input, ip, user.id);
    }
    if (!user.mfaEnabledAt) {
      return this.failed('mfa_not_set_up', input, ip, user.id);
    }
    // Checked only after the right password, so codes cannot be tried without
    // it. A code that works is used up and never works again.
    if (!(await this.codeIsValid(user.id, input.code))) {
      return this.failed('wrong_code', input, ip, user.id);
    }

    await this.attempts.succeeded(input.email, ip);
    return this.sessions.start(user.id, 'staff');
  }

  // The signed-in staff member's own account. Never the password hash or
  // the MFA secret.
  getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        mfaEnabledAt: true,
        createdAt: true,
      },
    });
  }

  // An error here (for example a changed MFA_ENCRYPTION_KEY) must not give a
  // different answer either: it would show that the password was right.
  private async codeIsValid(userId: string, code: string): Promise<boolean> {
    try {
      return await this.mfa.verifyAndUse(userId, code);
    } catch (error) {
      this.logger.error(
        { userId, reason: 'code_check_failed', err: error },
        'Staff MFA code could not be checked',
      );
      return false;
    }
  }

  // Logs the reason, counts the failure, and answers 401. The attempt that
  // goes over a limit answers 429 instead.
  private async failed(
    reason: StaffLoginFailure,
    input: StaffLoginInput,
    ip: string,
    userId?: string,
  ): Promise<never> {
    // Unknown emails are mostly noise. Anything else involves a real account.
    if (reason === 'unknown_account') {
      this.logger.info({ reason }, 'Staff sign-in failed');
    } else {
      this.logger.warn({ userId, reason }, 'Staff sign-in failed');
    }
    await this.attempts.failed(input.email, ip, userId);
    throw new UnauthorizedException(INVALID_STAFF_CREDENTIALS);
  }
}
