import { z } from 'zod';
import { email } from '../auth/auth.schemas';

// A staff password protects far more than one customer account, so it must
// be longer. MFA comes on top of it (part 3B-2).
const staffPassword = z
  .string()
  .min(16, 'Staff passwords must be at least 16 characters')
  .max(128, 'Password must be at most 128 characters');
const fullName = z.string().trim().min(1, 'Name is required').max(100);

export const superUserSchema = z.object({
  email,
  fullName,
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

// A Super User invites an Admin with only the email and the name: the Admin
// chooses their own password from the invitation link. Unknown fields, such
// as a role or a password, are dropped.
export const adminInviteSchema = z.object({ email, fullName });
export type AdminInviteInput = z.infer<typeof adminInviteSchema>;
