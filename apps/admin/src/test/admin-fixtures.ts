import type { Admin } from '../admins/admins-api';
import { json } from './fake-api';

// Admins in each state, as the API sends them. Links that still work end in
// 2099; those that ended, in 2020, so the tests hold on any day.

export const ADMINS = 'GET /v1/staff/admins';
export const INVITE = 'POST /v1/staff/admins';
export const RESEND = (admin: Admin) =>
  `POST /v1/staff/admins/${admin.id}/invitation`;
export const RESET = (admin: Admin) =>
  `POST /v1/staff/admins/${admin.id}/authenticator-reset`;
export const STATUS = (admin: Admin) => `PATCH /v1/staff/admins/${admin.id}`;
export const REMOVE = (admin: Admin) => `DELETE /v1/staff/admins/${admin.id}`;

const LATER = '2099-11-22T10:00:00.000Z';
const ENDED = '2020-11-22T10:00:00.000Z';

// Signs in with a password and an authenticator app.
export const ACTIVE: Admin = {
  id: '6a000000-0000-4000-8000-000000000001',
  email: 'asha@example.com',
  fullName: 'Asha Verma',
  status: 'ACTIVE',
  invitationAcceptedAt: '2026-11-02T05:00:00.000Z',
  invitationExpiresAt: null,
  authenticatorLinkExpiresAt: null,
  mfaEnabledAt: '2026-11-02T05:00:00.000Z',
  createdAt: '2026-11-01T05:00:00.000Z',
};

// Lost their phone: reset, with a link that still works.
export const RESET_PENDING: Admin = {
  ...ACTIVE,
  id: '6a000000-0000-4000-8000-000000000002',
  email: 'meena@example.com',
  fullName: 'Meena Iyer',
  mfaEnabledAt: null,
  authenticatorLinkExpiresAt: LATER,
};

// Reset, and the link ended unused.
export const RESET_ENDED: Admin = {
  ...RESET_PENDING,
  id: '6a000000-0000-4000-8000-000000000003',
  email: 'kiran@example.com',
  fullName: 'Kiran Rao',
  authenticatorLinkExpiresAt: null,
};

// Invited, and the link still works.
export const INVITED: Admin = {
  ...ACTIVE,
  id: '6a000000-0000-4000-8000-000000000004',
  email: 'dev@example.com',
  fullName: 'Dev Patel',
  invitationAcceptedAt: null,
  invitationExpiresAt: LATER,
  mfaEnabledAt: null,
  createdAt: '2026-11-18T05:00:00.000Z',
};

// Invited, and the link ended unused.
export const INVITATION_ENDED: Admin = {
  ...INVITED,
  id: '6a000000-0000-4000-8000-000000000005',
  email: 'lata@example.com',
  fullName: 'Lata Menon',
  invitationExpiresAt: ENDED,
};

// Disabled after joining.
export const DISABLED: Admin = {
  ...ACTIVE,
  id: '6a000000-0000-4000-8000-000000000006',
  email: 'arjun@example.com',
  fullName: 'Arjun Singh',
  status: 'DISABLED',
};

export const EVERY_ADMIN = [
  ACTIVE,
  RESET_PENDING,
  RESET_ENDED,
  INVITED,
  INVITATION_ENDED,
  DISABLED,
];

export const adminsOf = (admins: Admin[]) => () => json(200, { admins });
export const adminOf = (admin: Admin) => () => json(200, admin);

export const invitedOf =
  (admin: Admin, invitationSent = true) =>
  () =>
    json(201, {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: 'ADMIN',
      invitationExpiresAt: LATER,
      invitationSent,
    });

export const resetOf =
  (admin: Admin, emailSent = true) =>
  () =>
    json(201, {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      authenticatorLinkExpiresAt: LATER,
      emailSent,
    });
