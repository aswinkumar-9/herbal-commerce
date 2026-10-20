import { generateToken, hashToken } from './token.util';

describe('token utilities', () => {
  it('generates a long URL-safe token', () => {
    const { token } = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores a hash that differs from the token and can be recomputed', () => {
    const { token, tokenHash } = generateToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(tokenHash);
  });

  it('never generates the same token twice', () => {
    expect(generateToken().token).not.toBe(generateToken().token);
  });
});
