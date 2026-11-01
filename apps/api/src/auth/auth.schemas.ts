import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email().max(254);
// The rules for choosing a password: at registration and at a reset.
const newPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');
// A single-use token from an email link (43 characters in practice).
export const emailedToken = z.string().min(20).max(200);
// A person's name, as they want to be addressed.
export const fullName = z.string().trim().min(1, 'Name is required').max(100);


// Unknown fields (for example "role") are dropped by zod, never passed on.
export const registerSchema = z.object({
  email,
  password: newPassword,
  fullName,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z.object({ token: emailedToken });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({ email });
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

// Login checks only the length: the password rules may change later,
// and passwords made under the old rules must keep working.
export const loginSchema = z.object({
  email,
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password must be at most 128 characters'),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Refresh and logout both take the refresh token in the body.
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({ token: emailedToken, newPassword });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// What customers may change about their own account. The email address is
// not here: changing it needs a new verification, which comes later.
export const updateProfileSchema = z.object({ fullName });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Changing the password while signed in. The current one proves it is the
// owner, not someone holding a stolen access token; like the login, only its
// length is checked. The new one follows the registration rules.
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'Password is required')
      .max(128, 'Password must be at most 128 characters'),
    newPassword,
  })
  .refine((input) => input.newPassword !== input.currentPassword, {
    message: 'The new password must be different from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
