import { ConfigService } from '@nestjs/config';
import { RetryLaterException } from '../common/retry-later.exception';
import type { Env } from '../config/env';
import type { ValkeyService } from '../valkey/valkey.service';
import { RateLimitService } from './rate-limit.service';
import { RATE_LIMITS } from './rate-limits';

const config = {
  get: () => 'test-secret-'.repeat(4),
} as unknown as ConfigService<Env, true>;
const LOGIN = RATE_LIMITS.login;

// A stand-in for Valkey that counts like the real one: [count, ms left].
function workingValkey() {
  const counts = new Map<string, number>();
  const client = {
    defineCommand: jest.fn(),
    rlflxIncr: jest.fn(([key, points, seconds]: string[]) => {
      counts.set(key, (counts.get(key) ?? 0) + Number(points));
      return Promise.resolve([counts.get(key), Number(seconds) * 1000]);
    }),
  };
  return { counts, valkey: client as unknown as ValkeyService };
}

// A stand-in for Valkey while it is down: every command fails.
function brokenValkey(): ValkeyService {
  const client = {
    defineCommand: jest.fn(),
    rlflxIncr: jest.fn(() => Promise.reject(new Error('connection refused'))),
  };
  return client as unknown as ValkeyService;
}

async function useUpLogin(service: RateLimitService, key: string) {
  for (let i = 0; i < LOGIN.points; i += 1) {
    await service.consume('login', key);
  }
}

// Runs a call that must be refused, and returns the refusal.
async function refusal(run: () => Promise<void>): Promise<RetryLaterException> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RetryLaterException) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the call to be refused');
}

describe('RateLimitService', () => {
  it('allows requests up to the limit, then answers 429 with a wait time', async () => {
    const service = new RateLimitService(workingValkey().valkey, config);
    await useUpLogin(service, '203.0.113.7');

    const refused = await refusal(() => service.consume('login', '203.0.113.7'));
    expect(refused.getStatus()).toBe(429);
    expect(refused.getResponse()).toEqual({
      message: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    });
    expect(refused.retryAfterSeconds).toBe(LOGIN.duration);
  });

  it('counts each client separately', async () => {
    const service = new RateLimitService(workingValkey().valkey, config);
    await useUpLogin(service, '203.0.113.7');
    await expect(
      service.consume('login', '198.51.100.2'),
    ).resolves.toBeUndefined();
  });

  it('stores only a hash of the key in Valkey', async () => {
    const { counts, valkey } = workingValkey();
    const service = new RateLimitService(valkey, config);
    await service.consume('login', 'aswin@example.com');

    const [stored] = Array.from(counts.keys());
    expect(stored).toMatch(/^rl:login:[0-9a-f]{32}$/);
    expect(stored).not.toContain('aswin');
  });

  it('keeps limiting in memory while Valkey is down', async () => {
    const service = new RateLimitService(brokenValkey(), config);
    await useUpLogin(service, '203.0.113.7');

    const refused = await refusal(() => service.consume('login', '203.0.113.7'));
    expect(refused.getStatus()).toBe(429);
  });
});
