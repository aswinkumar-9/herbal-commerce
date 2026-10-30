import { auditContextOf } from './audit-context';

const SUPER_USER = {
  id: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  sessionId: 'session-1',
  role: 'SUPER_USER' as const,
};

describe('auditContextOf', () => {
  it('takes the actor from the checked caller, with the address and request ID', () => {
    expect(
      auditContextOf({
        user: SUPER_USER,
        ip: '::ffff:203.0.113.7',
        id: 'f460dbf5-a94c-471a-9484-50c78e298cad',
      }),
    ).toEqual({
      actorId: SUPER_USER.id,
      ip: '203.0.113.7',
      requestId: 'f460dbf5-a94c-471a-9484-50c78e298cad',
    });
  });

  it('keeps an IPv6 address whole, unlike the rate limits', () => {
    expect(auditContextOf({ ip: '2001:db8:abcd:12:1:2:3:4' }).ip).toBe(
      '2001:db8:abcd:12:1:2:3:4',
    );
  });

  it('leaves out what the request does not know', () => {
    expect(auditContextOf({})).toEqual({
      actorId: undefined,
      ip: undefined,
      requestId: undefined,
    });
    expect(auditContextOf({ id: 42 }).requestId).toBe('42');
  });
});
