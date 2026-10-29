import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// The settings every authenticator app supports (Google, Microsoft, Authy).
const DIGITS = 6;
const PERIOD_SECONDS = 30;
// Codes from one step before or after now still count: ±30 seconds, for a
// phone clock that is slightly off.
const WINDOW_STEPS = 1;
// RFC 4226 recommends a 160-bit secret.
const SECRET_BYTES = 20;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// RFC 4648 base32, without padding: how authenticator apps take secrets.
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

// Accepts lower case, spaces and "=" padding, as people type secrets.
export function base32Decode(text: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.replace(/[\s=]/g, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Not a base32 string');
    }
    value = ((value << 5) | index) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// A new random secret, in base32 (32 characters).
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

// HOTP (RFC 4226): an HMAC-SHA1 of the counter, cut down to a few digits.
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

// TOTP (RFC 6238) uses the number of 30-second steps since 1970 as counter.
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS);
}

function sameCode(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Returns the time step the code belongs to, or null when it does not match.
// The caller stores that step: a code at or before the last used step is
// refused, so every code works for one sign-in only.
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null = null,
): number | null {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  const key = base32Decode(secret);
  const current = totpStep(nowMs);
  for (let step = current - WINDOW_STEPS; step <= current + WINDOW_STEPS; step += 1) {
    if (lastUsedStep !== null && step <= lastUsedStep) {
      continue;
    }
    if (sameCode(hotp(key, step), code)) {
      return step;
    }
  }
  return null;
}

// The link an authenticator app understands (also what a QR code holds).
export function otpauthUri(
  secret: string,
  account: string,
  issuer = 'Herbal Commerce',
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return (
    `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`
  );
}
