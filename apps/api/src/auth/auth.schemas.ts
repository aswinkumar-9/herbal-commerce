import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email().max(254);
// The rules for choosing a password: at registration and at a reset.
const newPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');
// A single-use token from an email link (43 characters in practice).
const emailedToken = z.string().min(20).max(200);

// Unknown fields (for example "role") are dropped by zod, never passed on.
export const registerSchema = z.object({
  email,
  password: newPassword,
  fullName: z.string().trim().min(1, 'Name is required').max(100),
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
