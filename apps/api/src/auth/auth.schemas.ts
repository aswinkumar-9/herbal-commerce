import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

// Unknown fields (for example "role") are dropped by zod, never passed on.
export const registerSchema = z.object({
  email,
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128, 'Password must be at most 128 characters'),
  fullName: z.string().trim().min(1, 'Name is required').max(100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(200),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({ email });
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>


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
;
