import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from './auth.schemas';

describe('auth schemas', () => {
  const valid = {
    email: ' Asha@Example.com ',
    password: 'a-long-password-1',
    fullName: ' Asha ',
  };

  it('normalises the email and the name', () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('asha@example.com');
    expect(parsed.fullName).toBe('Asha');
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
    const parsed = loginSchema.parse({ email: ' Asha@Example.com ', password: 'x' });
    expect(parsed.email).toBe('asha@example.com');
    expect(loginSchema.safeParse({ email: 'asha@example.com', password: '' }).success).toBe(false);
    expect(
      loginSchema.safeParse({ email: 'asha@example.com', password: 'x'.repeat(129) }).success,
    ).toBe(false);
  });

  it('requires a plausible refresh token', () => {
    expect(refreshTokenSchema.safeParse({ refreshToken: 'abc' }).success).toBe(false);
    expect(
      refreshTokenSchema.safeParse({ refreshToken: 'a'.repeat(43) }).success,
    ).toBe(true);
  });

  it('normalises the email of a password reset request', () => {
    expect(forgotPasswordSchema.parse({ email: ' Asha@Example.com ' }).email).toBe(
      'asha@example.com',
    );
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('holds a new password to the registration rules and needs a plausible token', () => {
    const token = 'a'.repeat(43);
    const ok = 'a-long-password-1';
    expect(resetPasswordSchema.safeParse({ token, newPassword: ok }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ token, newPassword: 'short' }).success).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token, newPassword: 'x'.repeat(129) }).success,
    ).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: 'abc', newPassword: ok }).success).toBe(false);
  });

  // New in Part 3C-1.
  it('lets a customer change only their name, trimmed, 1 to 100 characters', () => {
    expect(
      updateProfileSchema.parse({
        fullName: ' Asha K ',
        email: 'other@example.com',
        role: 'ADMIN',
      }),
    ).toEqual({ fullName: 'Asha K' });
    expect(updateProfileSchema.safeParse({ fullName: ' ' }).success).toBe(false);
    expect(
      updateProfileSchema.safeParse({ fullName: 'x'.repeat(101) }).success,
    ).toBe(false);
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });

  it('changes the password only with the current one, to a different new one', () => {
    const accepts = (changes: object) =>
      changePasswordSchema.safeParse({
        currentPassword: 'old-short',
        newPassword: 'a-long-password-2',
        ...changes,
      }).success;
    // Like the login, the current password is checked for its length only.
    expect(accepts({})).toBe(true);
    expect(accepts({ currentPassword: '' })).toBe(false);
    expect(accepts({ currentPassword: 'x'.repeat(129) })).toBe(false);
    expect(accepts({ newPassword: 'short' })).toBe(false);
    expect(accepts({ newPassword: 'x'.repeat(129) })).toBe(false);
    expect(
      accepts({ currentPassword: 'same-password-1', newPassword: 'same-password-1' }),
    ).toBe(false);
  });
});
