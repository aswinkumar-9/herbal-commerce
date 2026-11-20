import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import {
  ACTIVE,
  ADMINS,
  INVITED,
  adminsOf,
  invitedOf,
  resetOf,
} from '../test/admin-fixtures';
import { fakeApi, json } from '../test/fake-api';
import {
  inviteAdmin,
  listAdmins,
  removeAdmin,
  resendInvitation,
  resetAuthenticator,
  setAdminStatus,
} from './admins-api';

const NOT_UNDERSTOOD =
  'The server sent an answer the console does not understand.';

describe('the Admins API', () => {
  it('lists the Admins with the access token, and refuses an answer with a secret or a role it does not know', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [ADMINS]: [
        adminsOf([ACTIVE]),
        () => json(200, { admins: [{ ...ACTIVE, status: 'DELETED' }] }),
        () => json(200, { admins: [{ ...ACTIVE, createdAt: 'yesterday' }] }),
      ],
    });

    await expect(listAdmins()).resolves.toEqual([ACTIVE]);
    await expect(listAdmins()).rejects.toThrow(NOT_UNDERSTOOD);
    await expect(listAdmins()).rejects.toThrow(NOT_UNDERSTOOD);
    expect(api.sent.every((r) => r.authorization === 'Bearer t1')).toBe(true);
  });

  it('keeps only what the console shows, even if the API sent more', async () => {
    setAccessToken('t1');
    fakeApi({
      [ADMINS]: () =>
        json(200, {
          admins: [{ ...ACTIVE, passwordHash: 'x', mfaSecret: 'y' }],
        }),
    });

    const [admin] = await listAdmins();
    expect(admin).not.toHaveProperty('passwordHash');
    expect(admin).not.toHaveProperty('mfaSecret');
  });

  it('sends each step to its own address, with only what it needs', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      'POST /v1/staff/admins': invitedOf(INVITED),
      [`POST /v1/staff/admins/${INVITED.id}/invitation`]: invitedOf(INVITED),
      [`POST /v1/staff/admins/${ACTIVE.id}/authenticator-reset`]:
        resetOf(ACTIVE),
      [`PATCH /v1/staff/admins/${ACTIVE.id}`]: () =>
        json(200, { ...ACTIVE, status: 'DISABLED' }),
      [`DELETE /v1/staff/admins/${INVITED.id}`]: () => json(204),
    });

    await expect(
      inviteAdmin({ fullName: 'Dev Patel', email: 'dev@example.com' }),
    ).resolves.toMatchObject({ id: INVITED.id, invitationSent: true });
    await expect(resendInvitation(INVITED.id)).resolves.toMatchObject({
      invitationSent: true,
    });
    await expect(resetAuthenticator(ACTIVE.id)).resolves.toMatchObject({
      emailSent: true,
    });
    await expect(setAdminStatus(ACTIVE.id, 'DISABLED')).resolves.toMatchObject({
      status: 'DISABLED',
    });
    await expect(removeAdmin(INVITED.id)).resolves.toBeUndefined();

    expect(api.unexpected).toEqual([]);
    expect(api.sent.map((r) => [r.method, r.body])).toEqual([
      ['POST', { fullName: 'Dev Patel', email: 'dev@example.com' }],
      ['POST', undefined],
      ['POST', undefined],
      ['PATCH', { status: 'DISABLED' }],
      ['DELETE', undefined],
    ]);
  });

  it('never puts something that is not an ID into an address', async () => {
    setAccessToken('t1');
    const api = fakeApi({});

    for (const step of [
      () => resendInvitation('../orders'),
      () => resetAuthenticator('x/y'),
      () => setAdminStatus('?status=x', 'ACTIVE'),
      () => removeAdmin(''),
    ]) {
      await expect(step()).rejects.toBeInstanceOf(ApiError);
    }
    expect(api.sent).toEqual([]);
  });
});
