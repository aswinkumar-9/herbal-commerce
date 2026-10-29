import { HttpException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { RetryLaterException } from '../common/retry-later.exception';
import { PrismaService } from '../prisma/prisma.service';
import { StaffAuthService } from './staff-auth.service';
import { StaffMfaService } from './staff-mfa.service';

const IP = '203.0.113.7';
const input = {
  email: 'dev.admin@example.com',
  password: 'a-staff-pass-16ch',
  code: '123456',
};
const admin = {
  id: 'staff-1',
  role: 'ADMIN',
  status: 'ACTIVE',
  passwordHash: '$argon2id$fake-hash',
  mfaEnabledAt: new Date('2026-10-28T00:00:00Z'),
};
const TOKENS = {
  accessToken: 'signed-access-token',
  tokenType: 'Bearer',
  expiresIn: 900,
  refreshToken: 'raw-refresh-token',
};

const tooManyRequests = () =>
  new RetryLaterException(429, 'Too many requests.', 'RATE_LIMITED', 900);

function setup() {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(admin) } };
  const passwords = {
    verify: jest.fn().mockResolvedValue(true),
    verifyDummy: jest.fn().mockResolvedValue(false),
  };
  const mfa = { verifyAndUse: jest.fn().mockResolvedValue(true) };
  const sessions = { start: jest.fn().mockResolvedValue(TOKENS) };
  const attempts = {
    check: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
    succeeded: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new StaffAuthService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    mfa as unknown as StaffMfaService,
    sessions as unknown as SessionService,
    attempts as unknown as LoginAttemptsService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, passwords, mfa, sessions, attempts, logger };
}
type Setup = ReturnType<typeof setup>;

// Every way a staff sign-in can fail, each as a setup that fails that way.
function failures(): Record<string, Setup> {
  const unknown = setup();
  unknown.prisma.user.findUnique.mockResolvedValue(null);
  const customer = setup();
  customer.prisma.user.findUnique.mockResolvedValue({
    ...admin,
    role: 'CUSTOMER',
  });
  const wrongPassword = setup();
  wrongPassword.passwords.verify.mockResolvedValue(false);
  const disabled = setup();
  disabled.prisma.user.findUnique.mockResolvedValue({
    ...admin,
    status: 'DISABLED',
  });
  const noMfa = setup();
  noMfa.prisma.user.findUnique.mockResolvedValue({
    ...admin,
    mfaEnabledAt: null,
  });
  const wrongCode = setup();
  wrongCode.mfa.verifyAndUse.mockResolvedValue(false);
  const brokenCodeCheck = setup();
  brokenCodeCheck.mfa.verifyAndUse.mockRejectedValue(
    new Error('Unsupported state or unable to authenticate data'),
  );
  return {
    unknown,
    customer,
    wrongPassword,
    disabled,
    noMfa,
    wrongCode,
    brokenCodeCheck,
  };
}

// Runs a login that must fail and returns the error the client would get.
async function loginError(service: StaffAuthService): Promise<HttpException> {
  try {
    await service.login(input, IP);
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('the login unexpectedly succeeded');
}

describe('StaffAuthService.login', () => {
  it('signs in an Admin or Super User with the right password and code', async () => {
    for (const role of ['ADMIN', 'SUPER_USER']) {
      const { service, prisma, mfa, sessions, attempts } = setup();
      prisma.user.findUnique.mockResolvedValue({ ...admin, role });

      await expect(service.login(input, IP)).resolves.toEqual(TOKENS);
      expect(mfa.verifyAndUse).toHaveBeenCalledWith('staff-1', '123456');
      expect(sessions.start).toHaveBeenCalledWith('staff-1', 'staff');
      expect(attempts.succeeded).toHaveBeenCalledWith(input.email, IP);
      expect(attempts.failed).not.toHaveBeenCalled();
    }
  });

  it('gives one answer for every failure, and starts no session', async () => {
    const answers: unknown[] = [];
    for (const [name, failure] of Object.entries(failures())) {
      const error = await loginError(failure.service);

      expect([name, error.getStatus()]).toEqual([name, 401]);
      answers.push(error.getResponse());
      expect(failure.sessions.start).not.toHaveBeenCalled();
      expect(failure.attempts.succeeded).not.toHaveBeenCalled();
    }
    expect(answers[0]).toMatchObject({
      message: 'Invalid email, password or code',
    });
    for (const answer of answers) {
      expect(answer).toEqual(answers[0]);
    }
  });

  it('counts every failure against the login limits, unknown emails too', async () => {
    for (const [name, failure] of Object.entries(failures())) {
      await loginError(failure.service);

      const userId = name === 'unknown' ? undefined : 'staff-1';
      expect([name, failure.attempts.failed.mock.calls]).toEqual([
        name,
        [[input.email, IP, userId]],
      ]);
    }
  });

  it('never checks the password of an unknown or customer email, but takes as long', async () => {
    const { unknown, customer } = failures();
    for (const failure of [unknown, customer]) {
      await loginError(failure.service);

      expect(failure.passwords.verify).not.toHaveBeenCalled();
      expect(failure.passwords.verifyDummy).toHaveBeenCalledWith(
        input.password,
      );
      expect(failure.mfa.verifyAndUse).not.toHaveBeenCalled();
    }
  });

  it('checks the code only after the right password, for an active account with MFA', async () => {
    const { wrongPassword, disabled, noMfa } = failures();
    for (const failure of [wrongPassword, disabled, noMfa]) {
      await loginError(failure.service);

      expect(failure.mfa.verifyAndUse).not.toHaveBeenCalled();
    }
  });

  it('logs an error in the code check, and answers like a wrong code', async () => {
    const { brokenCodeCheck } = failures();

    expect((await loginError(brokenCodeCheck.service)).getStatus()).toBe(401);
    expect(brokenCodeCheck.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'staff-1',
        reason: 'code_check_failed',
      }),
      expect.any(String),
    );
  });

  it('logs why a sign-in failed, as a warning when a real account is involved', async () => {
    const { unknown, customer, wrongCode } = failures();
    await loginError(unknown.service);
    await loginError(customer.service);
    await loginError(wrongCode.service);

    expect(unknown.logger.info).toHaveBeenCalledWith(
      { reason: 'unknown_account' },
      'Staff sign-in failed',
    );
    expect(customer.logger.warn).toHaveBeenCalledWith(
      { userId: 'staff-1', reason: 'not_staff' },
      'Staff sign-in failed',
    );
    expect(wrongCode.logger.warn).toHaveBeenCalledWith(
      { userId: 'staff-1', reason: 'wrong_code' },
      'Staff sign-in failed',
    );
  });

  it('never logs the email, the password or the code', async () => {
    const all = Object.values(failures());
    for (const failure of all) {
      await loginError(failure.service);
    }

    const logged = JSON.stringify(
      all.map(({ logger }) => [
        logger.info.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
      ]),
    );
    expect(logged).toContain('wrong_code');
    for (const secret of [input.email, input.password, input.code]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('refuses with 429 before any lookup or password check while a limit is exceeded', async () => {
    const { service, prisma, passwords, attempts } = setup();
    attempts.check.mockRejectedValueOnce(tooManyRequests());

    expect((await loginError(service)).getStatus()).toBe(429);
    expect(attempts.check).toHaveBeenCalledWith(input.email, IP);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(passwords.verifyDummy).not.toHaveBeenCalled();
  });

  it('answers 429 instead of 401 for the failure that goes over a limit', async () => {
    const { wrongCode } = failures();
    wrongCode.attempts.failed.mockRejectedValueOnce(tooManyRequests());

    expect((await loginError(wrongCode.service)).getStatus()).toBe(429);
  });
});

describe('StaffAuthService.getProfile', () => {
  it('never selects the password hash or the MFA secret', async () => {
    const { service, prisma } = setup();

    await service.getProfile('staff-1');

    const [query] = prisma.user.findUnique.mock.calls[0] as [
      { where: object; select: Record<string, boolean> },
    ];
    expect(query.where).toEqual({ id: 'staff-1' });
    expect(Object.keys(query.select).sort()).toEqual([
      'createdAt',
      'email',
      'fullName',
      'id',
      'mfaEnabledAt',
      'role',
    ]);
  });
});
