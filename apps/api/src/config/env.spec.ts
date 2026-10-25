import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEnv } from './env';

// Obviously fake, but long and varied enough to pass the secret rules.
const SECRET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

function errorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    VALKEY_URL: 'redis://:pass@localhost:6379',
    JWT_ACCESS_SECRET: SECRET,
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

  it('requires a JWT access secret of at least 43 characters', () => {
    const { DATABASE_URL, VALKEY_URL } = valid;
    expect(() => validateEnv({ DATABASE_URL, VALKEY_URL })).toThrow(
      'JWT_ACCESS_SECRET',
    );
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: SECRET.slice(0, 42) }),
    ).toThrow('JWT_ACCESS_SECRET');
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: SECRET.slice(0, 43) }),
    ).not.toThrow();
  });

  it('rejects secrets with other characters or too little variety', () => {
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: `${SECRET}+/=` }),
    ).toThrow('JWT_ACCESS_SECRET');
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: 'ab'.repeat(32) }),
    ).toThrow('JWT_ACCESS_SECRET');
  });

  it('refuses the .env.example secret without echoing it', () => {
    const example = readFileSync(
      join(__dirname, '../../../../.env.example'),
      'utf8',
    );
    const committed =
      /^JWT_ACCESS_SECRET=(.*)$/m.exec(example)?.[1]?.trim() ?? '';
    expect(committed).not.toBe('');
    const message = errorMessage(() =>
      validateEnv({ ...valid, JWT_ACCESS_SECRET: committed }),
    );
    expect(message).toContain('JWT_ACCESS_SECRET');
    expect(message).not.toContain(committed);
  });

  it('refuses placeholders and plain-http links in production', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      WEB_BASE_URL: 'https://shop.example.com',
    };
    expect(() => validateEnv(production)).not.toThrow();
    expect(() =>
      validateEnv({
        ...production,
        DATABASE_URL: 'postgresql://app:change_me_locally@db:5432/shop',
      }),
    ).toThrow('DATABASE_URL');
    expect(() =>
      validateEnv({ ...production, WEB_BASE_URL: 'http://shop.example.com' }),
    ).toThrow('WEB_BASE_URL');
  });

  it('allows the local placeholders in development', () => {
    expect(() =>
      validateEnv({
        ...valid,
        VALKEY_URL: 'redis://:change_me_locally@localhost:6379',
      }),
    ).not.toThrow();
  });
});
