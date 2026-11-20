import { dayName, momentName } from '../stock/stock-display';
import type { Admin } from './admins-api';

// Where an Admin stands, as a Super User needs to know it: what they can
// do now, and what the Super User can do for them.
export type AdminState =
  // Signs in with a password and an authenticator app.
  | 'ACTIVE'
  // Accepted the invitation, but has no authenticator app now: a Super
  // User reset it after a lost phone (ADR 0038). They can't sign in until
  // they set it up again from the emailed link.
  | 'NEEDS_APP'
  // Hasn't chosen a password yet, and the link still works.
  | 'INVITED'
  // Hasn't chosen a password, and the link has ended.
  | 'INVITATION_ENDED'
  // Can't sign in until a Super User enables them.
  | 'DISABLED';

// `now`: when the list was read, so the answer stays the same between reads.
export function adminState(admin: Admin, now: number): AdminState {
  if (admin.status === 'DISABLED') {
    return 'DISABLED';
  }
  if (admin.invitationAcceptedAt === null) {
    return stillWorks(admin.invitationExpiresAt, now)
      ? 'INVITED'
      : 'INVITATION_ENDED';
  }
  return admin.mfaEnabledAt === null ? 'NEEDS_APP' : 'ACTIVE';
}

export const ADMIN_STATE_NAMES: Record<AdminState, string> = {
  ACTIVE: 'Active',
  NEEDS_APP: 'No authenticator app',
  INVITED: 'Invited',
  INVITATION_ENDED: 'Invitation ended',
  DISABLED: 'Disabled',
};

export const ADMIN_STATE_STYLES: Record<AdminState, string> = {
  ACTIVE: 'bg-primary-soft text-primary-strong',
  NEEDS_APP: 'bg-warning-soft text-warning',
  INVITED: 'bg-surface-muted text-ink-muted',
  INVITATION_ENDED: 'bg-warning-soft text-warning',
  DISABLED: 'bg-danger-soft text-danger',
};

// One sentence under the Admin's name: since when, and what comes next.
export function adminDetail(admin: Admin, now: number): string {
  const state = adminState(admin, now);
  const invited = `Invited ${dayOf(admin.createdAt)}.`;
  switch (state) {
    case 'ACTIVE':
      return `Joined ${dayOf(admin.invitationAcceptedAt ?? admin.createdAt)}.`;
    case 'NEEDS_APP':
      return stillWorks(admin.authenticatorLinkExpiresAt, now)
        ? `Can’t sign in until they set up their authenticator app again. Their link works until ${momentName(admin.authenticatorLinkExpiresAt ?? '')}.`
        : 'Can’t sign in until they set up an authenticator app. Their link has ended: send a new one.';
    case 'INVITED':
      return `${invited} The link works until ${momentName(admin.invitationExpiresAt ?? '')}.`;
    case 'INVITATION_ENDED':
      return `${invited} The link has ended: send the invitation again.`;
    case 'DISABLED':
      return admin.invitationAcceptedAt === null
        ? `${invited} Never accepted the invitation.`
        : 'Can’t sign in until enabled again.';
  }
}

function stillWorks(until: string | null, now: number): boolean {
  return until !== null && Date.parse(until) > now;
}

// The day in India, such as "12 Nov 2026".
function dayOf(at: string): string {
  return dayName(
    new Date(Date.parse(at) + 330 * 60_000).toISOString().slice(0, 10),
  );
}
