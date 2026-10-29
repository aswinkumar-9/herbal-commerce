import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpStep,
  verifyTotp,
} from './totp';

// The shared secret all the RFC test vectors use: the ASCII text below.
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC_SECRET_BASE32 = base32Encode(RFC_SECRET);
const STEP_MS = 30 * 1000;

describe('base32', () => {
  // RFC 4648, section 10 (without the "=" padding).
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];

  it('encodes and decodes the RFC 4648 test vectors', () => {
    for (const [text, encoded] of vectors) {
      expect(base32Encode(Buffer.from(text))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(text);
    }
  });

  it('accepts what people type: lower case, spaces and padding', () => {
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
  });

  it('refuses characters outside the base32 alphabet', () => {
    for (const text of ['MZXW0', 'MZXW1', 'MZXW8', 'MZXW!']) {
      expect(() => base32Decode(text)).toThrow('Not a base32 string');
    }
  });
});

describe('HOTP and TOTP', () => {
  it('matches the HOTP test vectors of RFC 4226 (appendix D)', () => {
    const expected = [
      '755224', '287082', '359152', '969429', '338314',
      '254676', '287922', '162583', '399871', '520489',
    ];
    expected.forEach((code, counter) => {
      expect(hotp(RFC_SECRET, counter)).toBe(code);
    });
  });

  it('matches the TOTP test vectors of RFC 6238 (appendix B, SHA-1)', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(hotp(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(code);
    }
  });
});

describe('verifyTotp', () => {
  const now = 1_700_000_000_000;
  const step = totpStep(now);
  const codeAt = (s: number) => hotp(RFC_SECRET, s);

  it('accepts the current code, and one step either side, but not two', () => {
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step - 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step + 2), now)).toBeNull();
  });

  it('never accepts a code twice, nor one from before the last used step', () => {
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step - 1), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step + 1), now, step)).toBe(step + 1);
    // Half a minute later the next code works as usual.
    expect(verifyTotp(RFC_SECRET_BASE32, codeAt(step + 1), now + STEP_MS, step)).toBe(
      step + 1,
    );
  });

  it('refuses anything that is not exactly 6 digits', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', '12 456', ' 123456']) {
      expect(verifyTotp(RFC_SECRET_BASE32, code, now)).toBeNull();
    }
  });
});

describe('secrets and setup links', () => {
  it('makes a new 160-bit secret every time, in base32', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it('builds the otpauth link authenticator apps understand', () => {
    expect(otpauthUri('JBSWY3DPEHPK3PXP', 'dev.super1@example.com')).toBe(
      'otpauth://totp/Herbal%20Commerce:dev.super1%40example.com' +
        '?secret=JBSWY3DPEHPK3PXP&issuer=Herbal%20Commerce' +
        '&algorithm=SHA1&digits=6&period=30',
    );
  });
});
