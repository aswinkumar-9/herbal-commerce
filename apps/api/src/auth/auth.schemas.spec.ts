import {
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from './auth.schemas';

describe('auth schemas', () => {
  const valid = {
    email: ' Aswin@Example.com ',
    password: 'a-long-password-1',
    fullName: ' Aswin ',
  };

  it('normalises the email and the name', () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('aswin@example.com');
    expect(parsed.fullName).toBe('Aswin');
  });

  it('drops a role sent by the client', () => {
    const parsed = registerSchema.parse({ ...valid, role: 'SUPER_USER' });
    expect(parsed).not.toHaveProperty('role');
  });

  it('rejects passwords that are too short or too long', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    expect(
      registerSchema.safeParse({ ...valid, password: 'x'.repeat(129) }).success,
    ).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(resendVerificationSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('requires a plausible verification token', () => {
    expect(verifyEmailSchema.safeParse({ token: 'abc' }).success).toBe(false);
    expect(verifyEmailSchema.safeParse({ token: 'a'.repeat(43) }).success).toBe(true);
  });

  it('normalises the login email and only checks the password length', () => {
    const parsed = loginSchema.parse({ email: ' Aswin@Example.com ', password: 'x' });
    expect(parsed.email).toBe('aswin@example.com');
    expect(loginSchema.safeParse({ email: 'aswin@example.com', password: '' }).success).toBe(false);
    expect(
      loginSchema.safeParse({ email: 'aswin@example.com', password: 'x'.repeat(129) }).success,
    ).toBe(false);
  });

});
