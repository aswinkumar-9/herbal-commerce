import { z } from 'zod';
import { apiRequest } from '../api/client';
import { idInPath } from '../catalog/catalog-api';

// The Admins API, for Super Users only (ADR 0004, ADR 0015, ADR 0038):
// every Admin, inviting one, the invitation sent again, the authenticator
// app reset after a lost phone, disabling, enabling and removing. Every
// answer is checked against these shapes.

const ADMINS = '/v1/staff/admins';
const moment = z.iso.datetime();

export const ADMIN_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

// What a Super User sees of an Admin. Never a password or a key.
export const adminSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  status: z.enum(ADMIN_STATUSES),
  // When they chose their password with the invitation: null while it is
  // pending.
  invitationAcceptedAt: moment.nullable(),
  // When the newest unused invitation stops working, if there is one.
  invitationExpiresAt: moment.nullable(),
  // When the newest link to set the authenticator app up again stops
  // working, after a reset, if there is one.
  authenticatorLinkExpiresAt: moment.nullable(),
  mfaEnabledAt: moment.nullable(),
  createdAt: moment,
});
export type Admin = z.infer<typeof adminSchema>;
const adminListSchema = z.object({ admins: z.array(adminSchema) });

// An invitation made or sent again. False invitationSent: the email could
// not go, so it must be sent again.
const invitedSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  invitationExpiresAt: moment,
  invitationSent: z.boolean(),
});
export type Invited = z.infer<typeof invitedSchema>;

// An authenticator app reset. False emailSent: the link did not go.
const resetSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  authenticatorLinkExpiresAt: moment,
  emailSent: z.boolean(),
});
export type AuthenticatorReset = z.infer<typeof resetSchema>;

export interface InviteFields {
  fullName: string;
  email: string;
}

export async function listAdmins(signal?: AbortSignal): Promise<Admin[]> {
  const { admins } = await apiRequest(ADMINS, {
    schema: adminListSchema,
    signal,
  });
  return admins;
}

export async function inviteAdmin(fields: InviteFields): Promise<Invited> {
  return apiRequest(ADMINS, {
    method: 'POST',
    body: fields,
    schema: invitedSchema,
  });
}

// A new link for a pending Admin: the one in the earlier email stops
// working.
export async function resendInvitation(id: string): Promise<Invited> {
  return apiRequest(`${idInPath(ADMINS, id)}/invitation`, {
    method: 'POST',
    schema: invitedSchema,
  });
}

// The Admin's app stops working, their sessions end, and they are emailed
// a link to set it up again with their password.
export async function resetAuthenticator(
  id: string,
): Promise<AuthenticatorReset> {
  return apiRequest(`${idInPath(ADMINS, id)}/authenticator-reset`, {
    method: 'POST',
    schema: resetSchema,
  });
}

// Disabling also ends every session of the Admin.
export async function setAdminStatus(
  id: string,
  status: AdminStatus,
): Promise<Admin> {
  return apiRequest(idInPath(ADMINS, id), {
    method: 'PATCH',
    body: { status },
    schema: adminSchema,
  });
}

// Only a disabled Admin, or one who never accepted the invitation.
export async function removeAdmin(id: string): Promise<void> {
  return apiRequest(idInPath(ADMINS, id), { method: 'DELETE' });
}
