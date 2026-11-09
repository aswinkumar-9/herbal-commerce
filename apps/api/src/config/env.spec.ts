import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEnv } from './env';

// Obviously fake, but long and varied enough to pass the secret rules.
const SECRET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const OTHER_SECRET = SECRET.split('').reverse().join('');
const THIRD_SECRET = SECRET.slice(10) + SECRET.slice(0, 10);

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
    MFA_ENCRYPTION_KEY: OTHER_SECRET,
    RAZORPAY_KEY_ID: 'rzp_test_FakeKey0123',
    RAZORPAY_KEY_SECRET: 'TestKeySecretFake0123456',
    RAZORPAY_WEBHOOK_SECRET: THIRD_SECRET,
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

  it('refuses the .env.example secrets without echoing them', () => {
    const example = readFileSync(
      join(__dirname, '../../../../.env.example'),
      'utf8',
    );
    for (const key of [
      'JWT_ACCESS_SECRET',
      'MFA_ENCRYPTION_KEY',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
    ]) {
      const committed =
        new RegExp(`^${key}=(.*)$`, 'm').exec(example)?.[1]?.trim() ?? '';
      expect(committed).not.toBe('');
      const message = errorMessage(() =>
        validateEnv({ ...valid, [key]: committed }),
      );
      expect(message).toContain(key);
      expect(message).not.toContain(committed);
    }
  });

  it('refuses placeholders, plain-http links and a Razorpay test key in production', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      WEB_BASE_URL: 'https://shop.example.com',
      MEDIA_BASE_URL: 'https://media.example.com',
      RAZORPAY_KEY_ID: 'rzp_live_FakeKey0123',
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
    expect(() =>
      validateEnv({ ...production, MEDIA_BASE_URL: 'http://media.example.com' }),
    ).toThrow('MEDIA_BASE_URL');
    expect(() =>
      validateEnv({ ...production, RAZORPAY_KEY_ID: 'rzp_test_FakeKey0123' }),
    ).toThrow('RAZORPAY_KEY_ID: must be a live key (rzp_live_) in production');
  });

  it('keeps images in storage/media and links them from the API by default', () => {
    const env = validateEnv(valid);
    expect(env.MEDIA_DIR).toBe('storage/media');
    expect(env.MEDIA_BASE_URL).toBe('http://127.0.0.1:3000/media');
  });

  it('drops a final "/" from the image address, and wants an http or https one', () => {
    expect(
      validateEnv({ ...valid, MEDIA_BASE_URL: 'https://media.example.com/' })
        .MEDIA_BASE_URL,
    ).toBe('https://media.example.com');
    for (const value of ['media.example.com', 'ftp://media.example.com', 'https://', '']) {
      expect(() => validateEnv({ ...valid, MEDIA_BASE_URL: value })).toThrow(
        'MEDIA_BASE_URL',
      );
    }
    expect(() => validateEnv({ ...valid, MEDIA_DIR: '' })).toThrow('MEDIA_DIR');
  });

  it('allows the local placeholders in development', () => {
    expect(() =>
      validateEnv({
        ...valid,
        VALKEY_URL: 'redis://:change_me_locally@localhost:6379',
      }),
    ).not.toThrow();
  });

  it('trusts no proxy unless TRUST_PROXY lists one', () => {
    expect(validateEnv(valid).TRUST_PROXY).toEqual([]);
    expect(validateEnv({ ...valid, TRUST_PROXY: '' }).TRUST_PROXY).toEqual([]);
    expect(
      validateEnv({
        ...valid,
        TRUST_PROXY: 'loopback, 10.0.0.0/8, 2001:db8::/32',
      }).TRUST_PROXY,
    ).toEqual(['loopback', '10.0.0.0/8', '2001:db8::/32']);
  });

  it('rejects hop counts and invalid proxy entries', () => {
    for (const value of [
      '1',
      'true',
      '*',
      '10.0.0.0/33',
      '10.0.0.1/8/8',
      'proxy.example.com',
    ]) {
      expect(() => validateEnv({ ...valid, TRUST_PROXY: value })).toThrow(
        'TRUST_PROXY',
      );
    }
  });

  it('requires an MFA encryption key that differs from the JWT secret', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: valid.DATABASE_URL,
        VALKEY_URL: valid.VALKEY_URL,
        JWT_ACCESS_SECRET: SECRET,
      }),
    ).toThrow('MFA_ENCRYPTION_KEY');

    const message = errorMessage(() =>
      validateEnv({ ...valid, MFA_ENCRYPTION_KEY: SECRET }),
    );
    expect(message).toContain('must not be the same as JWT_ACCESS_SECRET');
    expect(message).not.toContain(SECRET);
  });

  it('requires the Razorpay key ID, its secret and our webhook secret', () => {
    for (const key of [
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
    ]) {
      const without: Record<string, unknown> = { ...valid };
      delete without[key];
      expect(() => validateEnv(without)).toThrow(key);
    }
  });

  it('accepts only a Razorpay key ID of the test or live kind', () => {
    expect(
      validateEnv({ ...valid, RAZORPAY_KEY_ID: 'rzp_live_FakeKey0123' })
        .RAZORPAY_KEY_ID,
    ).toBe('rzp_live_FakeKey0123');
    for (const value of [
      'rzp_FakeKey0123',
      'rzp_demo_FakeKey0123',
      'rzp_test_Fake',
      'rzp_test_Fake-Key0123',
      ' rzp_test_FakeKey0123',
    ]) {
      expect(() => validateEnv({ ...valid, RAZORPAY_KEY_ID: value })).toThrow(
        'RAZORPAY_KEY_ID',
      );
    }
  });

  it('wants a key secret of at least 16 letters and digits', () => {
    expect(() =>
      validateEnv({ ...valid, RAZORPAY_KEY_SECRET: 'TestKeySecret012' }),
    ).not.toThrow();
    for (const value of ['TestKeySecret01', 'TestKeySecretFake012345!', '']) {
      expect(() =>
        validateEnv({ ...valid, RAZORPAY_KEY_SECRET: value }),
      ).toThrow('RAZORPAY_KEY_SECRET');
    }
  });

  it('wants a strong webhook secret of its own, without echoing it', () => {
    expect(() =>
      validateEnv({ ...valid, RAZORPAY_WEBHOOK_SECRET: SECRET.slice(0, 42) }),
    ).toThrow('RAZORPAY_WEBHOOK_SECRET');
    for (const reused of [SECRET, OTHER_SECRET]) {
      const message = errorMessage(() =>
        validateEnv({ ...valid, RAZORPAY_WEBHOOK_SECRET: reused }),
      );
      expect(message).toContain(
        'RAZORPAY_WEBHOOK_SECRET: must not be the same as JWT_ACCESS_SECRET or MFA_ENCRYPTION_KEY',
      );
      expect(message).not.toContain(reused);
    }
  });
});
