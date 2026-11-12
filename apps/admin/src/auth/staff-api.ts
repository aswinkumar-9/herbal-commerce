import { z } from 'zod';
import { setAccessToken } from '../api/access-token';
import { apiRequest, tokenSchema } from '../api/client';

export const staffProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(['ADMIN', 'SUPER_USER']),
});
export type StaffProfile = z.infer<typeof staffProfileSchema>;
export type StaffRole = StaffProfile['role'];

export const ROLE_NAMES: Record<StaffRole, string> = {
  ADMIN: 'Admin',
  SUPER_USER: 'Super User',
};

// The API's own rules (staffLoginSchema), so a slip is caught before
// anything is sent. The password's length only: older passwords still work.
export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Enter your email address')
    .max(254, 'That email address is too long')
    .pipe(z.email('Enter a valid email address')),
  password: z
    .string()
    .min(1, 'Enter your password')
    .max(128, 'Passwords are at most 128 characters'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export async function signInRequest(input: SignInInput): Promise<void> {
  const tokens = await apiRequest('/v1/staff/auth/login', {
    method: 'POST',
    body: input,
    schema: tokenSchema,
    anonymous: true,
  });
  setAccessToken(tokens.accessToken);
}

export function fetchProfile(): Promise<StaffProfile> {
  return apiRequest('/v1/staff/me', { schema: staffProfileSchema });
}

// The API ends the session and forgets the cookie. The token in memory is
// forgotten only once that worked, so staff are never told they signed out
// while the session is still open.
export async function signOutRequest(): Promise<void> {
  await apiRequest('/v1/staff/auth/logout', {
    method: 'POST',
    anonymous: true,
  });
  setAccessToken(null);
}
