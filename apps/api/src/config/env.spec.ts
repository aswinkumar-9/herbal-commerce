import { validateEnv } from './env';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    VALKEY_URL: 'redis://:pass@localhost:6379',
  };

  it('accepts a valid configuration and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.API_PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ VALKEY_URL: valid.VALKEY_URL })).toThrow(
      'DATABASE_URL',
    );
  });

  it('rejects an invalid port', () => {
    expect(() => validateEnv({ ...valid, API_PORT: 'abc' })).toThrow(
      'API_PORT',
    );
  });
});
