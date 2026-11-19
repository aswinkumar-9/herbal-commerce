import { z } from 'zod';
import { apiRequest } from '../api/client';

// The emailed links for Admins (ADR 0015, ADR 0038): an invitation, where the
// Admin chooses a password and sets up an authenticator app together, and a
// new start for the app after a Super User reset it. Nobody is signed in:
// the link's token is the only proof, so it goes in the body, never in an
// address the server logs.

const AUTH = '/v1/staff/auth';

export type LinkPurpose = 'INVITE' | 'AUTHENTICATOR_RESET';

// The token from the link: 32 random bytes, in base64url. Anything else was
// cut short or changed on its way, and is never sent.
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

export function linkToken(search: string): string | null {
  const token = new URLSearchParams(search).get('token');
  return token !== null && TOKEN.test(token) ? token : null;
}

// Who the link is for, and the key to put into the authenticator app, as
// text and as the otpauth:// address a QR code holds.
const linkSchema = z.object({
  purpose: z.enum(['INVITE', 'AUTHENTICATOR_RESET']),
  email: z.string(),
  fullName: z.string(),
  // Base32, as every authenticator app takes it.
  key: z.string().regex(/^[A-Z2-7]{16,128}$/),
  uri: z.string().startsWith('otpauth://totp/').max(512),
  expiresAt: z.iso.datetime(),
});
export type SetupLink = z.infer<typeof linkSchema>;

const doneSchema = z.object({ message: z.string() });

// Opening the link makes its key, once: opening it again shows the same one.
export function openSetupLink(
  token: string,
  signal?: AbortSignal,
): Promise<SetupLink> {
  return apiRequest(`${AUTH}/setup-link`, {
    method: 'POST',
    body: { token },
    schema: linkSchema,
    anonymous: true,
    signal,
  });
}

export interface SetupFields {
  token: string;
  password: string;
  code: string;
}

// An invitation: the password the Admin chose, and a code from the app.
export async function acceptInvitation(fields: SetupFields): Promise<void> {
  await apiRequest(`${AUTH}/accept-invite`, {
    method: 'POST',
    body: fields,
    schema: doneSchema,
    anonymous: true,
  });
}

// After a reset: the Admin's own password, and a code from the app.
export async function setUpAgain(fields: SetupFields): Promise<void> {
  await apiRequest(`${AUTH}/reset-authenticator`, {
    method: 'POST',
    body: fields,
    schema: doneSchema,
    anonymous: true,
  });
}

// "JBSWY3DPEHPK3PXP" as "JBSW Y3DP EHPK 3PXP", easier to type by hand.
export function keyInGroups(key: string): string {
  return key.replace(/(.{4})(?=.)/g, '$1 ');
}
