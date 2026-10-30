import { PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { LoginAttemptsService } from './login-attempts.service';

const IP = '203.0.113.7';
const EMAIL = 'asha@example.com';
// The three failed-login counters for EMAIL from IP.
const FAILURE_COUNTERS = [
  ['loginFailuresByEmailAndIp', `${IP}|${EMAIL}`],
  ['loginFailuresByEmail', EMAIL],
  ['loginFailuresByIp', IP],
];

const tooManyRequests = () =>
  new RetryLaterException(429, 'Too many requests.', 'RATE_LIMITED', 900);

function setup() {
  const limits = {
    check: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { warn: jest.fn() };
  const attempts = new LoginAttemptsService(
    limits as unknown as RateLimitService,
    logger as unknown as PinoLogger,
  );
  return { attempts, limits, logger };
}

describe('LoginAttemptsService', () => {
  it('checks all three counters without counting anything', async () => {
    const { attempts, limits } = setup();

    await attempts.check(EMAIL, IP);

    expect(limits.check.mock.calls).toEqual(FAILURE_COUNTERS);
    expect(limits.consume).not.toHaveBeenCalled();
  });

  it('refuses with 429 while any counter is blocked', async () => {
    const { attempts, limits } = setup();
    limits.check.mockRejectedValueOnce(tooManyRequests());

    await expect(attempts.check(EMAIL, IP)).rejects.toBeInstanceOf(
      RetryLaterException,
    );
  });

  it('counts a failed sign-in against all three counters', async () => {
    const { attempts, limits, logger } = setup();

    await attempts.failed(EMAIL, IP, 'user-1');

    expect(limits.consume.mock.calls).toEqual(FAILURE_COUNTERS);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('throws 429 for the failure that goes over a limit, and logs it without the email', async () => {
    const { attempts, limits, logger } = setup();
    limits.consume.mockRejectedValueOnce(tooManyRequests());

    await expect(attempts.failed(EMAIL, IP, 'user-1')).rejects.toBeInstanceOf(
      RetryLaterException,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.stringContaining('Too many failed sign-ins'),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(EMAIL);
  });

  it('passes other errors on without calling them a block', async () => {
    const { attempts, limits, logger } = setup();
    limits.consume.mockRejectedValueOnce(new Error('store unavailable'));

    await expect(attempts.failed(EMAIL, IP)).rejects.toThrow(
      'store unavailable',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('after a successful sign-in, resets only this email and IP', async () => {
    const { attempts, limits } = setup();

    await attempts.succeeded(EMAIL, IP);

    expect(limits.reset.mock.calls).toEqual([FAILURE_COUNTERS[0]]);
    expect(limits.consume).not.toHaveBeenCalled();
  });
});
