import { z } from 'zod';
import { email } from '../auth/auth.schemas';

// A staff password protects far more than one customer account, so it must
// be longer. MFA comes on top of it (part 3B-2).
const staffPassword = z
  .string()
  .min(16, 'Staff passwords must be at least 16 characters')
  .max(128, 'Password must be at most 128 characters');

export const superUserSchema = z.object({
  email,
  fullName: z.string().trim().min(1, 'Name is required').max(100),
  password: staffPassword,
});
export type SuperUserInput = z.infer<typeof superUserSchema>;

// Staff sign in with the password and the code their authenticator app shows
// now, in one request. Like the customer login, only the password's length is
// checked, so passwords made under older rules keep working.
export const staffLoginSchema = z.object({
  email,
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password must be at most 128 characters'),
  code: z.string().trim().regex(/^\d{6}$/, 'The code must be 6 digits'),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;
