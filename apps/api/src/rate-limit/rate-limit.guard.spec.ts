import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RetryLaterException } from '../common/retry-later.exception';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

function setup(routeLimits?: string[]) {
  const reflector = { get: jest.fn().mockReturnValue(routeLimits) };
  const limits = { consume: jest.fn().mockResolvedValue(undefined) };
  // req.ip as Express reports it for an IPv4 client on an IPv6 socket.
  const request = { ip: '::ffff:203.0.113.7' };
  const context = {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new RateLimitGuard(
    reflector as unknown as Reflector,
    limits as unknown as RateLimitService,
  );
  return { guard, context, limits };
}

describe('RateLimitGuard', () => {
  it('counts every request against the baseline for the client IP', async () => {
    const { guard, context, limits } = setup();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(limits.consume.mock.calls).toEqual([['baseline', '203.0.113.7']]);
  });

  it('adds the limits the route asks for', async () => {
    const { guard, context, limits } = setup(['login']);

    await guard.canActivate(context);
    expect(limits.consume.mock.calls).toEqual([
      ['baseline', '203.0.113.7'],
      ['login', '203.0.113.7'],
    ]);
  });

  it('passes the 429 on and stops counting once a limit refuses', async () => {
    const { guard, context, limits } = setup(['login']);
    const refusal = new RetryLaterException(
      429,
      'Too many requests.',
      'RATE_LIMITED',
      30,
    );
    limits.consume.mockRejectedValueOnce(refusal);

    await expect(guard.canActivate(context)).rejects.toBe(refusal);
    expect(limits.consume).toHaveBeenCalledTimes(1);
  });
});
