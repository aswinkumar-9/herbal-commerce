// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addressProblems,
  forApi,
  readAddress,
} from '../address-checks.server.ts';
import { INDIAN_STATES } from '../indian-states.ts';
import type { CustomerSession } from '../session.server.ts';
import { answer, contextWith, outcome, post } from '../test/route-calls.ts';
import {
  action as passwordAction,
  loader as passwordLoader,
} from './account-password.tsx';
import {
  action as accountAction,
  loader as accountLoader,
} from './account.tsx';
import { action as editAction, loader as editLoader } from './address-edit.tsx';
import { action as newAction, loader as newLoader } from './address-new.tsx';
import { loader as signInLoader } from './sign-in.tsx';

const SITE = 'http://localhost:3001';
const API = 'http://127.0.0.1:3000/v1';
const SIGNED_IN: CustomerSession = {
  accessToken: 'access.jwt.one',
  refreshToken: 'refresh-token-one-0123456789',
  accessEndsAt: Date.now() + 10 * 60_000,
  endsAt: Date.now() + 20 * 24 * 60 * 60_000,
};
const ID = '0b6f3c1e-8f3a-4c55-9a51-3c2b1d7e9f10';
const OTHER_ID = '7d0c2b4a-1e2f-4a3b-8c9d-0e1f2a3b4c5d';
const HOME = {
  id: ID,
  fullName: 'Asha Verma',
  phone: '9845012345',
  line1: '12 MG Road',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  isDefault: true,
};
const OFFICE = {
  ...HOME,
  id: OTHER_ID,
  line1: '4 Residency Road',
  isDefault: false,
};
// An address form, as typed.
const TYPED = {
  intent: 'save',
  fullName: ' Asha Verma ',
  phone: '+91 98450-12345',
  line1: '12 MG Road',
  line2: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560 001',
};

const fetchMock = vi.fn<typeof fetch>();
const sent = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [URL, RequestInit];
  return {
    url: String(url),
    method: init.method,
    body: init.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    authorization: new Headers(init.headers).get('authorization'),
  };
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

type Run = (args: never) => unknown;

// A page's loader or action, called as React Router would.
function call(
  run: Run,
  url: string,
  {
    form,
    params = {},
    session = SIGNED_IN,
  }: {
    form?: Record<string, string>;
    params?: Record<string, string>;
    session?: CustomerSession | null;
  } = {},
) {
  const { context, handle } = contextWith(session);
  const request = form
    ? post(`${SITE}${url}`, form)
    : new Request(`${SITE}${url}`);
  return {
    handle,
    result: outcome(() => run({ request, context, params } as never)),
  };
}

describe('every account page', () => {
  it('is only for a signed-in customer: anyone else signs in first, and comes back', async () => {
    for (const [run, url, params] of [
      [accountLoader, '/account', {}],
      [passwordLoader, '/account/password', {}],
      [newLoader, '/account/addresses/new', {}],
      [editLoader, `/account/addresses/${ID}`, { id: ID }],
    ] as const) {
      const { result } = call(run as Run, url, { params, session: null });
      expect(await result).toMatchObject({
        status: 302,
        location: `/sign-in?next=${encodeURIComponent(url)}`,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs out here, and to sign in, when the API no longer knows the session', async () => {
    fetchMock.mockResolvedValue(answer(401, { message: 'Unauthorized' }));
    const { handle, result } = call(accountAction as Run, '/account', {
      form: { intent: 'name', fullName: 'Asha K' },
    });
    expect(await result).toMatchObject({
      status: 302,
      location: '/sign-in?next=%2Faccount',
    });
    expect(handle.current).toBeNull();
  });
});

describe('the account page', () => {
  it('says what was done on an address page, only in its own words', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith('/addresses')
        ? answer(200, [])
        : answer(200, { fullName: 'Asha Verma', email: 'asha@example.com' }),
    );
    const added = await call(accountLoader as Run, '/account?saved=added')
      .result;
    expect(added.data).toMatchObject({ saved: 'added' });
    const made = await call(
      accountLoader as Run,
      '/account?saved=hasOwnProperty',
    ).result;
    expect(made.data).toMatchObject({ saved: null });
  });

  it('changes the name with the session’s token', async () => {
    fetchMock.mockResolvedValue(answer(200, { fullName: 'Asha K' }));
    const { result } = call(accountAction as Run, '/account', {
      form: { intent: 'name', fullName: '  Asha K  ' },
    });
    expect(await result).toMatchObject({
      status: 200,
      data: { saved: 'name', problems: {} },
    });
    expect(sent()).toEqual({
      url: `${API}/me`,
      method: 'PATCH',
      body: { fullName: 'Asha K' },
      authorization: 'Bearer access.jwt.one',
    });
  });

  it('says what to fix in the name before asking, and what the API refused', async () => {
    const empty = await call(accountAction as Run, '/account', {
      form: { intent: 'name', fullName: '   ' },
    }).result;
    expect(empty).toMatchObject({
      status: 400,
      data: { problems: { fullName: 'Enter your name.' } },
    });
    const long = await call(accountAction as Run, '/account', {
      form: { intent: 'name', fullName: 'A'.repeat(101) },
    }).result;
    expect(long.data).toMatchObject({
      problems: { fullName: 'A name has at most 100 characters.' },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      answer(400, { errors: [{ field: 'fullName', message: 'Too odd' }] }),
    );
    const refused = await call(accountAction as Run, '/account', {
      form: { intent: 'name', fullName: 'Asha' },
    }).result;
    expect(refused.data).toMatchObject({
      problems: { fullName: 'Enter your name.' },
      fullName: 'Asha',
    });

    fetchMock.mockResolvedValueOnce(answer(503, {}));
    const resting = await call(accountAction as Run, '/account', {
      form: { intent: 'name', fullName: 'Asha' },
    }).result;
    expect(resting).toMatchObject({
      status: 503,
      data: {
        problems: {
          form: 'We could not save your name just now. Please try again in a minute.',
        },
      },
    });
  });

  it('makes an address the default, and says when it is gone', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, OFFICE));
    const made = await call(accountAction as Run, '/account', {
      form: { intent: 'default', id: OTHER_ID },
    }).result;
    expect(made.data).toMatchObject({ saved: 'default' });
    expect(sent()).toMatchObject({
      url: `${API}/me/addresses/${OTHER_ID}`,
      method: 'PATCH',
      body: { isDefault: true },
    });

    fetchMock.mockResolvedValueOnce(
      answer(404, { message: 'Address not found' }),
    );
    const gone = await call(accountAction as Run, '/account', {
      form: { intent: 'default', id: OTHER_ID },
    }).result;
    expect(gone).toMatchObject({
      status: 404,
      data: { problems: { form: 'That address is no longer saved.' } },
    });
  });

  it('never puts a strange ID into the API’s address', async () => {
    const { result } = call(accountAction as Run, '/account', {
      form: { intent: 'default', id: '../me/password' },
    });
    expect((await result).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs out everywhere: the API ends every session, then this one ends', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { handle, result } = call(accountAction as Run, '/account', {
      form: { intent: 'everywhere' },
    });
    expect(await result).toMatchObject({
      status: 302,
      location: '/sign-in?ended=everywhere',
    });
    expect(sent()).toMatchObject({
      url: `${API}/me/sessions`,
      method: 'DELETE',
      authorization: 'Bearer access.jwt.one',
    });
    expect(handle.current).toBeNull();
  });

  it('stays signed in, and says so, when the API could not sign out everywhere', async () => {
    fetchMock.mockResolvedValue(answer(503, {}));
    const { handle, result } = call(accountAction as Run, '/account', {
      form: { intent: 'everywhere' },
    });
    expect(await result).toMatchObject({
      status: 503,
      data: {
        problems: {
          form: 'We could not sign you out everywhere just now. Please try again in a minute.',
        },
      },
    });
    expect(handle.current).toEqual(SIGNED_IN);
  });

  it('does nothing for a form it does not know', async () => {
    const { result } = call(accountAction as Run, '/account', {
      form: { intent: 'delete-account' },
    });
    expect((await result).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('changing the password', () => {
  const change = (fields: Record<string, string>) =>
    call(passwordAction as Run, '/account/password', { form: fields });

  it('gives the page the email address, for the password manager', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { fullName: 'Asha Verma', email: 'asha@example.com' }),
    );
    const { result } = call(passwordLoader as Run, '/account/password');
    expect((await result).data).toEqual({
      email: 'asha@example.com',
      origin: SITE,
    });
  });

  it('sends both passwords, then signs out here and says so on the sign-in page', async () => {
    fetchMock.mockResolvedValue(answer(200, { message: 'Changed' }));
    const { handle, result } = change({
      currentPassword: 'the old password',
      newPassword: 'a brand new password',
    });
    expect(await result).toMatchObject({
      status: 302,
      location: '/sign-in?ended=password',
    });
    expect(sent()).toEqual({
      url: `${API}/me/password`,
      method: 'POST',
      body: {
        currentPassword: 'the old password',
        newPassword: 'a brand new password',
      },
      authorization: 'Bearer access.jwt.one',
    });
    expect(handle.current).toBeNull();
  });

  it('says what to fix before asking, and never sends a password back', async () => {
    for (const [fields, problems] of [
      [
        { currentPassword: '', newPassword: 'a brand new password' },
        { currentPassword: 'Enter your current password.' },
      ],
      [
        { currentPassword: 'the old password', newPassword: 'short' },
        { newPassword: 'Choose a password with at least 10 characters.' },
      ],
      [
        {
          currentPassword: 'the same password',
          newPassword: 'the same password',
        },
        { newPassword: 'Choose a password different from the current one.' },
      ],
    ] as const) {
      const result = await change(fields).result;
      expect(result).toMatchObject({ status: 400, data: { problems } });
      for (const typed of Object.values(fields).filter(Boolean)) {
        expect(JSON.stringify(result.data)).not.toContain(typed);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says when the current password is wrong, how long to wait, and when the shop is resting', async () => {
    const fields = {
      currentPassword: 'a wrong password',
      newPassword: 'a brand new password',
    };
    fetchMock.mockResolvedValueOnce(
      answer(400, { message: 'The current password is wrong.' }),
    );
    expect(await change(fields).result).toMatchObject({
      status: 400,
      data: {
        problems: { currentPassword: 'The current password is not right.' },
      },
    });

    fetchMock.mockResolvedValueOnce(
      answer(400, { errors: [{ field: 'newPassword', message: 'Too short' }] }),
    );
    expect((await change(fields).result).data).toMatchObject({
      problems: {
        newPassword: 'Choose a password with at least 10 characters.',
      },
    });

    fetchMock.mockResolvedValueOnce(
      answer(429, { message: 'Too many' }, { 'retry-after': '300' }),
    );
    expect(await change(fields).result).toMatchObject({
      status: 429,
      data: {
        problems: {
          form: 'Too many tries. Please wait 5 minutes and try again.',
        },
      },
    });

    fetchMock.mockResolvedValueOnce(answer(503, {}));
    const { handle, result } = change(fields);
    expect(await result).toMatchObject({
      status: 503,
      data: {
        problems: {
          form: 'We could not change your password just now. Please try again in a minute.',
        },
      },
    });
    expect(handle.current).toEqual(SIGNED_IN);
  });
});

describe('adding an address', () => {
  const add = (fields: Record<string, string>) =>
    call(newAction as Run, '/account/addresses/new', { form: fields });

  it('knows how many there are, for the first one and the tenth', async () => {
    fetchMock.mockResolvedValue(answer(200, [HOME, OFFICE]));
    const { result } = call(newLoader as Run, '/account/addresses/new');
    expect((await result).data).toEqual({ count: 2, origin: SITE });
  });

  it('sends the address as the API keeps it, and goes back to the account', async () => {
    fetchMock.mockResolvedValue(answer(201, HOME));
    const { result } = add(TYPED);
    expect(await result).toMatchObject({
      status: 302,
      location: '/account?saved=added',
    });
    expect(sent()).toEqual({
      url: `${API}/me/addresses`,
      method: 'POST',
      body: {
        fullName: 'Asha Verma',
        phone: '9845012345',
        line1: '12 MG Road',
        line2: null,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      authorization: 'Bearer access.jwt.one',
    });
  });

  it('asks for it to be the default only when ticked', async () => {
    fetchMock.mockResolvedValue(answer(201, HOME));
    await add({ ...TYPED, isDefault: 'yes' }).result;
    expect(sent().body).toMatchObject({ isDefault: true });
  });

  it('says what to fix before asking, keeping what was typed', async () => {
    const { result } = add({
      intent: 'save',
      fullName: '',
      phone: '12345',
      line1: '',
      line2: 'x'.repeat(201),
      city: '',
      state: 'Atlantis',
      pincode: '012345',
      isDefault: 'yes',
    });
    expect(await result).toMatchObject({
      status: 400,
      data: {
        typed: { phone: '12345', state: 'Atlantis' },
        isDefault: true,
        problems: {
          fullName: 'Enter the name of the person receiving it.',
          phone: 'Enter a 10 digit Indian mobile number.',
          line1: 'Enter the house number and street.',
          line2: 'This has at most 200 characters.',
          city: 'Enter the city or town.',
          state: 'Choose a state or union territory.',
          pincode: 'Enter a 6 digit PIN code.',
        },
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says when there are 10 already, what the API refused, and when the shop is resting', async () => {
    fetchMock.mockResolvedValueOnce(answer(409, { message: 'At most 10' }));
    expect(await add(TYPED).result).toMatchObject({
      status: 409,
      data: {
        problems: {
          form: 'You have 10 addresses, the most we keep. Remove one to add another.',
        },
      },
    });
    fetchMock.mockResolvedValueOnce(
      answer(400, {
        errors: [{ field: 'pincode', message: 'Enter a 6-digit PIN code' }],
      }),
    );
    expect((await add(TYPED).result).data).toMatchObject({
      problems: { pincode: 'Enter a 6 digit PIN code.' },
    });
    fetchMock.mockResolvedValueOnce(answer(500, {}));
    expect((await add(TYPED).result).status).toBe(503);
  });
});

describe('changing or removing an address', () => {
  const open = (id: string) =>
    call(editLoader as Run, `/account/addresses/${id}`, { params: { id } });
  const send = (fields: Record<string, string>, id = ID) =>
    call(editAction as Run, `/account/addresses/${id}`, {
      form: fields,
      params: { id },
    });

  it('shows one of the customer’s own addresses, else “not found”', async () => {
    fetchMock.mockImplementation(async () => answer(200, [HOME, OFFICE]));
    expect((await open(OTHER_ID).result).data).toEqual({
      address: OFFICE,
      others: 1,
      origin: SITE,
    });
    expect(
      (await open('5f0c2b4a-1e2f-4a3b-8c9d-0e1f2a3b4c5d').result).status,
    ).toBe(404);
  });

  it('asks the API nothing for an address that is not an ID', async () => {
    expect((await open('not-an-id').result).status).toBe(404);
    expect((await send(TYPED, '..%2Fpassword').result).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves the change, and goes back to the account', async () => {
    fetchMock.mockResolvedValue(answer(200, HOME));
    expect(await send({ ...TYPED, isDefault: 'yes' }).result).toMatchObject({
      status: 302,
      location: '/account?saved=address',
    });
    expect(sent()).toMatchObject({
      url: `${API}/me/addresses/${ID}`,
      method: 'PATCH',
      body: { phone: '9845012345', pincode: '560001', isDefault: true },
    });
  });

  it('asks once more before removing, without asking the API', async () => {
    expect(await send({ intent: 'remove' }).result).toMatchObject({
      status: 200,
      data: { confirming: true, problems: {} },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes it once confirmed, and an address gone already is gone all the same', async () => {
    for (const status of [204, 404]) {
      fetchMock.mockResolvedValueOnce(
        status === 204 ? new Response(null, { status }) : answer(status, {}),
      );
      expect(await send({ intent: 'removeConfirmed' }).result).toMatchObject({
        status: 302,
        location: '/account?saved=removed',
      });
    }
    expect(sent()).toMatchObject({
      url: `${API}/me/addresses/${ID}`,
      method: 'DELETE',
    });
  });

  it('asks again, saying so, when the API could not remove it', async () => {
    fetchMock.mockResolvedValue(answer(503, {}));
    expect(await send({ intent: 'removeConfirmed' }).result).toMatchObject({
      status: 503,
      data: {
        confirming: true,
        problems: {
          form: 'We could not remove the address just now. Please try again in a minute.',
        },
      },
    });
  });
});

describe('the address checks', () => {
  const form = (fields: Record<string, string>) =>
    readAddress(new URLSearchParams({ ...TYPED, ...fields }) as never);

  it('take a phone and a PIN code as people write them', () => {
    for (const phone of [
      '9845012345',
      '+91 98450 12345',
      '91 98450 12345',
      '0 98450 12345',
    ]) {
      expect(addressProblems(form({ phone })).phone, phone).toBeUndefined();
      expect(forApi(form({ phone })).phone).toBe('9845012345');
    }
    for (const phone of [
      '5845012345',
      '98450 1234',
      '+1 9845012345',
      '9'.repeat(21),
    ]) {
      expect(addressProblems(form({ phone })).phone, phone).toBeDefined();
    }
    expect(forApi(form({ pincode: ' 560 001 ' })).pincode).toBe('560001');
    expect(addressProblems(form({ pincode: '56001' })).pincode).toBeDefined();
  });

  it('use the same states and union territories as the API', () => {
    const api = readFileSync(
      join(
        import.meta.dirname,
        '../../../api/src/addresses/addresses.schemas.ts',
      ),
      'utf8',
    );
    const list = /INDIAN_STATES = \[([\s\S]*?)\] as const/.exec(api)?.[1] ?? '';
    const names = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(names).toHaveLength(36);
    expect([...INDIAN_STATES]).toEqual(names);
  });
});

describe('the sign-in page after signing out on purpose', () => {
  it('says why only in its own words', async () => {
    for (const [ended, expected] of [
      ['password', 'password'],
      ['everywhere', 'everywhere'],
      ['constructor', null],
      ['', null],
    ] as const) {
      const { result } = call(signInLoader as Run, `/sign-in?ended=${ended}`, {
        session: null,
      });
      expect((await result).data).toMatchObject({ ended: expected });
    }
  });
});
