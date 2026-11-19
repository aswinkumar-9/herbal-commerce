import { describe, expect, it } from 'vitest';
import { fakeApi, json } from '../test/fake-api';
import { keyInGroups, linkToken, openSetupLink } from './setup-api';

const TOKEN = 'Zx8_w-Q2kP4mN7rT1vY6bC3dF9gH0jL5sA2eW8uI4oX';
const LINK = {
  purpose: 'INVITE',
  email: 'dev@example.com',
  fullName: 'Dev Patel',
  key: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Herbal%20Commerce:dev%40example.com?secret=JBSWY3DPEHPK3PXP',
  expiresAt: '2099-11-22T10:00:00.000Z',
};
const NOT_UNDERSTOOD =
  'The server sent an answer the console does not understand.';

describe('the token in a link', () => {
  it('is taken only as the 43 base64url characters an email holds, or close to it', () => {
    expect(linkToken(`?token=${TOKEN}`)).toBe(TOKEN);
    expect(linkToken(`?other=1&token=${TOKEN}`)).toBe(TOKEN);
    for (const search of [
      '',
      '?token=',
      '?token=short',
      `?token=${TOKEN}%20`,
      `?token=${TOKEN.slice(0, 30)}"><b>`,
      `?token=${'a'.repeat(201)}`,
    ]) {
      expect(linkToken(search)).toBeNull();
    }
  });
});

describe('opening a link', () => {
  it('takes only a base32 key and an otpauth address for the QR code', async () => {
    const api = fakeApi({
      'POST /v1/staff/auth/setup-link': [
        () => json(200, LINK),
        () => json(200, { ...LINK, key: 'jbswy3dpehpk3pxp' }),
        () => json(200, { ...LINK, uri: 'https://example.com/?secret=x' }),
        () => json(200, { ...LINK, purpose: 'SOMETHING_ELSE' }),
      ],
    });

    await expect(openSetupLink(TOKEN)).resolves.toEqual(LINK);
    for (let turn = 0; turn < 3; turn += 1) {
      await expect(openSetupLink(TOKEN)).rejects.toThrow(NOT_UNDERSTOOD);
    }
    expect(api.sent.every((r) => r.authorization === null)).toBe(true);
  });
});

it('shows a key in groups of four', () => {
  expect(keyInGroups('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
  expect(keyInGroups('JBSWY3DPEH')).toBe('JBSW Y3DP EH');
});
