import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces an argon2id hash that does not contain the password', async () => {
    const hashed = await service.hash('correct horse battery staple');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(hashed).not.toContain('correct horse');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hashed = await service.hash('correct horse battery staple');
    await expect(
      service.verify(hashed, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(service.verify(hashed, 'wrong password')).resolves.toBe(false);
  });

  it('uses a different salt every time', async () => {
    const first = await service.hash('same-password-123');
    const second = await service.hash('same-password-123');
    expect(first).not.toEqual(second);
  });

  it('treats a malformed stored hash as a mismatch', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
