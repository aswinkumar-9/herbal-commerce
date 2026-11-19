import { z } from 'zod';
import { AUDIT_KINDS } from '../audit/audit-reader.service';
import { email, emailedToken, fullName } from '../auth/auth.schemas';

// A staff password protects far more than one customer account, so it must
// be longer. MFA comes on top of it (part 3B-2).
const staffPassword = z
  .string()
  .min(16, 'Staff passwords must be at least 16 characters')
  .max(128, 'Password must be at most 128 characters');

export const superUserSchema = z.object({
  email,
  fullName,
  password: staffPassword,
});
export type SuperUserInput = z.infer<typeof superUserSchema>;

// The 6 digits an authenticator app shows now. Spaces around them are fine.
const authenticatorCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'The code must be 6 digits');

// A password being checked, not chosen: only its length, so passwords made
// under older rules keep working.
const passwordToCheck = z
  .string()
  .min(1, 'Password is required')
  .max(128, 'Password must be at most 128 characters');

// Staff sign in with the password and the code their authenticator app shows
// now, in one request. Like the customer login, only the password's length is
// checked, so passwords made under older rules keep working.
export const staffLoginSchema = z.object({
  email,
  password: passwordToCheck,
  code: authenticatorCode,
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

// A Super User invites an Admin with only the email and the name: the Admin
// chooses their own password from the invitation link. Unknown fields, such
// as a role or a password, are dropped.
export const adminInviteSchema = z.object({ email, fullName });
export type AdminInviteInput = z.infer<typeof adminInviteSchema>;

// The invited Admin chooses their password with the token from the link, and
// sets up the authenticator app at the same time (ADR 0038): the code proves
// the app holds the key the link showed.
export const acceptInviteSchema = z.object({
  token: emailedToken,
  password: staffPassword,
  code: authenticatorCode,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

// Whoever opened an emailed link asks for the key to put into the app.
export const setupLinkSchema = z.object({ token: emailedToken });
export type SetupLinkInput = z.infer<typeof setupLinkSchema>;

// After a Super User reset it, an Admin sets up the app again with the link,
// their own password and a code from the app.
export const resetAuthenticatorSchema = z.object({
  token: emailedToken,
  password: passwordToCheck,
  code: authenticatorCode,
});
export type ResetAuthenticatorInput = z.infer<typeof resetAuthenticatorSchema>;

// A Super User disables or enables an Admin. Nothing else about the account
// can be changed here.
export const adminStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});
export type AdminStatusInput = z.infer<typeof adminStatusSchema>;

// What a Super User may ask of the audit log. Query values arrive as text,
// so the number is converted. Unknown parameters are dropped.
export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.uuid().optional(),
  action: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/, 'An action looks like "admin.removed"')
    .optional(),
  actorId: z.uuid().optional(),
  targetId: z.string().min(1).max(100).optional(),
  kind: z
    .enum(AUDIT_KINDS, 'Use accounts, sign_ins, orders, catalog or stock')
    .optional(),
});
export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;
