import { superUserSchema } from './staff.schemas';

describe('superUserSchema', () => {
  const valid = {
    email: ' Super@Example.com ',
    fullName: ' Dev Super ',
    password: 'a-staff-pass-16ch',
  };

  it('normalises the email and the name', () => {
    const parsed = superUserSchema.parse(valid);
    expect(parsed.email).toBe('super@example.com');
    expect(parsed.fullName).toBe('Dev Super');
  });

  it('requires a staff password of 16 to 128 characters', () => {
    const withPassword = (password: string) =>
      superUserSchema.safeParse({ ...valid, password }).success;
    expect(withPassword('x'.repeat(15))).toBe(false);
    expect(withPassword('x'.repeat(16))).toBe(true);
    expect(withPassword('x'.repeat(129))).toBe(false);
  });
});
