import { validateEnv } from './env';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    VALKEY_URL: 'redis://:pass@localhost:6379',
    JWT_ACCESS_SECRET: 'x'.repeat(64),
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

  it('defaults LOG_LEVEL to info and rejects unknown levels', () => {
    expect(validateEnv(valid).LOG_LEVEL).toBe('info');
    expect(() => validateEnv({ ...valid, LOG_LEVEL: 'loud' })).toThrow(
      'LOG_LEVEL',
    );
  });

  it('applies mail defaults for local development', () => {
    const env = validateEnv(valid);
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.WEB_BASE_URL).toBe('http://localhost:3001');
  });

  it('requires a JWT access secret of at least 32 characters', () => {
    const { DATABASE_URL, VALKEY_URL } = valid;
    expect(() => validateEnv({ DATABASE_URL, VALKEY_URL })).toThrow(
      'JWT_ACCESS_SECRET',
    );
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: 'x'.repeat(31) }),
    ).toThrow('JWT_ACCESS_SECRET');
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: 'x'.repeat(32) }),
    ).not.toThrow();
  });

  it('rejects the .env.example placeholder without echoing it', () => {
    let message = '';
    try {
      validateEnv({ ...valid, JWT_ACCESS_SECRET: 'change_me' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('JWT_ACCESS_SECRET');
    expect(message).not.toContain('change_me');
  });
});
