import { staffLoginSchema, superUserSchema } from './staff.schemas';

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

describe('staffLoginSchema', () => {
  const valid = {
    email: ' Dev.Admin@Example.com ',
    password: 'a-staff-pass-16ch',
    code: ' 123456 ',
  };

  it('normalises the email and trims the code', () => {
    const parsed = staffLoginSchema.parse(valid);
    expect(parsed.email).toBe('dev.admin@example.com');
    expect(parsed.code).toBe('123456');
  });

  it('accepts only a 6-digit code and checks only the password length', () => {
    const accepts = (changes: object) =>
      staffLoginSchema.safeParse({ ...valid, ...changes }).success;
    for (const code of ['12345', '1234567', 'abcdef', '123 456', '']) {
      expect(accepts({ code })).toBe(false);
    }
    expect(accepts({ code: undefined })).toBe(false);
    expect(accepts({ password: '' })).toBe(false);
    expect(accepts({ password: 'short' })).toBe(true);
    expect(accepts({ password: 'x'.repeat(129) })).toBe(false);
  });
});
