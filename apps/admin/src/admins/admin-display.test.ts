import { describe, expect, it } from 'vitest';
import {
  ACTIVE,
  DISABLED,
  INVITATION_ENDED,
  INVITED,
  RESET_ENDED,
  RESET_PENDING,
} from '../test/admin-fixtures';
import { adminDetail, adminState } from './admin-display';

const NOW = Date.parse('2026-11-19T10:00:00.000Z');

describe('where an Admin stands', () => {
  it('tells each state apart', () => {
    expect(
      [
        ACTIVE,
        RESET_PENDING,
        RESET_ENDED,
        INVITED,
        INVITATION_ENDED,
        DISABLED,
      ].map((admin) => adminState(admin, NOW)),
    ).toEqual([
      'ACTIVE',
      'NEEDS_APP',
      'NEEDS_APP',
      'INVITED',
      'INVITATION_ENDED',
      'DISABLED',
    ]);
  });

  it('counts a link as ended from the moment it ends, as the API does', () => {
    const until = '2026-11-19T10:00:00.000Z';
    const invited = { ...INVITED, invitationExpiresAt: until };
    expect(adminState(invited, Date.parse(until) - 1)).toBe('INVITED');
    expect(adminState(invited, Date.parse(until))).toBe('INVITATION_ENDED');

    const reset = { ...RESET_PENDING, authenticatorLinkExpiresAt: until };
    expect(adminDetail(reset, Date.parse(until) - 1)).toContain(
      'Their link works until 19 Nov 2026, 15:30.',
    );
    expect(adminDetail(reset, Date.parse(until))).toContain(
      'Their link has ended: send a new one.',
    );
  });

  it('puts a disabled Admin first, whatever else is true of them', () => {
    expect(adminState({ ...RESET_PENDING, status: 'DISABLED' }, NOW)).toBe(
      'DISABLED',
    );
    expect(adminState({ ...INVITED, status: 'DISABLED' }, NOW)).toBe(
      'DISABLED',
    );
  });

  it('gives the days in India', () => {
    // 20:00 in UTC is the next morning in India.
    expect(
      adminDetail(
        { ...ACTIVE, invitationAcceptedAt: '2026-11-02T20:00:00.000Z' },
        NOW,
      ),
    ).toBe('Joined 3 Nov 2026.');
  });
});
