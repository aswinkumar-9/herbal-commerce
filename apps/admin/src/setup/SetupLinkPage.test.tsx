import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { routes } from '../App';
import { heldBack } from '../test/console';
import { ASHA, fakeApi, json, tokens } from '../test/fake-api';
import type { SetupLink } from './setup-api';

const TOKEN = 'Zx8_w-Q2kP4mN7rT1vY6bC3dF9gH0jL5sA2eW8uI4oX';
const OPEN = 'POST /v1/staff/auth/setup-link';
const ACCEPT = 'POST /v1/staff/auth/accept-invite';
const AGAIN = 'POST /v1/staff/auth/reset-authenticator';
const PASSWORD = 'four unrelated garden words';

const INVITATION: SetupLink = {
  purpose: 'INVITE',
  email: 'dev@example.com',
  fullName: 'Dev Patel',
  key: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Herbal%20Commerce:dev%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Herbal%20Commerce&algorithm=SHA1&digits=6&period=30',
  expiresAt: '2099-11-22T10:00:00.000Z',
};
const RESET: SetupLink = { ...INVITATION, purpose: 'AUTHENTICATOR_RESET' };

type Answers = Parameters<typeof fakeApi>[0];

// A link from the email, opened in a browser where nobody is signed in.
function openLink(path: string, answers: Answers = {}) {
  const api = fakeApi({
    'POST /v1/staff/auth/refresh': () =>
      json(401, { message: 'Invalid refresh token' }),
    [OPEN]: () => json(200, INVITATION),
    ...answers,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { api, router, queryClient, user: userEvent.setup() };
}

const invitation = (answers: Answers = {}) =>
  openLink(`/accept-invite?token=${TOKEN}`, answers);
const reset = (answers: Answers = {}) =>
  openLink(`/reset-authenticator?token=${TOKEN}`, {
    [OPEN]: () => json(200, RESET),
    ...answers,
  });
const button = (name: string) => screen.getByRole('button', { name });
const field = (label: string) => screen.getByLabelText(label);

async function fillInvitation(
  user: ReturnType<typeof userEvent.setup>,
  code = '123456',
) {
  await screen.findByRole('heading', { name: 'Welcome, Dev Patel' });
  await user.type(field('New password'), PASSWORD);
  await user.type(field('The same password again'), PASSWORD);
  await user.type(field('Authenticator code'), code);
}

describe('accepting an invitation', () => {
  it('shows who it is for, the QR code and the key, and takes the token out of the address bar', async () => {
    const { api, router } = invitation();

    expect(
      await screen.findByRole('heading', { name: 'Welcome, Dev Patel' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe(
        'Accept your invitation · Herbal Commerce Admin',
      ),
    );
    expect(router.state.location.pathname).toBe('/accept-invite');
    expect(router.state.location.search).toBe('');

    expect(field('Email')).toHaveValue('dev@example.com');
    expect(field('Email')).toHaveAttribute('readonly');
    expect(field('Email')).toHaveAttribute('autocomplete', 'username');
    expect(field('New password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(field('Authenticator code')).toHaveAttribute(
      'autocomplete',
      'one-time-code',
    );
    expect(
      screen.getByRole('group', { name: 'Step 1: Choose your password' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('figure', {
        name: 'QR code to add dev@example.com to your authenticator app',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This link works until 22 Nov 2099, 15:30, once.'),
    ).toBeInTheDocument();

    // The token goes in the body, and nothing else is sent with it.
    const opened = api.to('POST', '/v1/staff/auth/setup-link');
    expect(opened.map((r) => [r.body, r.authorization])).toEqual([
      [{ token: TOKEN }, null],
    ]);
  });

  it('draws the QR code from the address it was given, dark on white', async () => {
    invitation();
    const figure = await screen.findByRole('figure');
    const svg = figure.querySelector('svg');
    const [square, modules] = Array.from(svg?.children ?? []);

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(square).toHaveAttribute('fill', '#ffffff');
    expect(modules).toHaveAttribute('fill', '#000000');
    // A version that holds this address, inside the 4 empty modules all
    // round that scanners need.
    const side = Number(svg?.getAttribute('viewBox')?.split(' ')[2]);
    const d = modules?.getAttribute('d') ?? '';
    expect(d).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    const at = [...d.matchAll(/M(\d+) (\d+)/g)].flatMap((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(Math.min(...at)).toBe(4);
    expect(Math.max(...at)).toBe(side - 5);
    expect(side - 8).toBeGreaterThanOrEqual(21);
  });

  it('checks the password and the code before sending anything', async () => {
    const { user, api } = invitation();
    await screen.findByRole('heading', { name: 'Welcome, Dev Patel' });

    await user.type(field('New password'), 'too short');
    await user.click(button('Join Herbal Commerce'));
    expect(field('New password')).toHaveAccessibleDescription(
      expect.stringContaining('Use at least 16 characters'),
    );
    expect(field('New password')).toHaveFocus();

    await user.clear(field('New password'));
    await user.type(field('New password'), PASSWORD);
    await user.type(field('The same password again'), `${PASSWORD}!`);
    await user.type(field('Authenticator code'), '12a34');
    await user.click(button('Join Herbal Commerce'));

    expect(field('The same password again')).toHaveAccessibleDescription(
      expect.stringContaining('The two passwords are not the same'),
    );
    expect(field('Authenticator code')).toHaveValue('1234');
    expect(field('Authenticator code')).toHaveAccessibleDescription(
      expect.stringContaining('Type the 6 digits your app shows now'),
    );
    expect(api.to('POST', '/v1/staff/auth/accept-invite')).toEqual([]);
  });

  it('sends the password and the code with the token, then says to sign in, and forgets the key', async () => {
    const { user, api, queryClient } = invitation({
      [ACCEPT]: () =>
        json(200, {
          message:
            'Your password and authenticator app are set. Sign in with them.',
        }),
    });
    await fillInvitation(user);

    await user.click(button('Join Herbal Commerce'));

    expect(
      await screen.findByText(
        'Your password and authenticator app are set. Sign in with them.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('figure')).toBeNull();
    expect(screen.queryByText(/JBSW/)).toBeNull();
    // Nor is it kept anywhere in the console.
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['setup-link'] })
        .some((query) => query.state.data !== undefined),
    ).toBe(false);
    expect(
      api
        .to('POST', '/v1/staff/auth/accept-invite')
        .map((r) => [r.body, r.authorization]),
    ).toEqual([[{ token: TOKEN, password: PASSWORD, code: '123456' }, null]]);
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  it('sends no access token, even when someone is signed in on this browser', async () => {
    // Signed in already, before the link is opened.
    setAccessToken('t1');
    const { api } = openLink(`/accept-invite?token=${TOKEN}`, {
      'POST /v1/staff/auth/refresh': () => json(200, tokens('t1')),
      'GET /v1/staff/me': () => json(200, ASHA),
      [ACCEPT]: () => json(200, { message: 'set' }),
    });
    const user = userEvent.setup();
    await fillInvitation(user);
    await user.click(button('Join Herbal Commerce'));

    await screen.findByRole('link', { name: 'Go to sign in' });
    expect(
      api.sent
        .filter(
          (r) =>
            r.path.startsWith('/v1/staff/auth/setup-link') ||
            r.path.startsWith('/v1/staff/auth/accept-invite'),
        )
        .map((r) => r.authorization),
    ).toEqual([null, null]);
  });

  it('asks for a new code when the app did not make that one, keeping the password', async () => {
    const { user } = invitation({
      [ACCEPT]: () =>
        json(400, {
          message: 'Validation failed',
          errors: [
            {
              field: 'code',
              message:
                'That code is not right. Type the code your authenticator app shows now.',
            },
          ],
        }),
    });
    await fillInvitation(user);

    await user.click(button('Join Herbal Commerce'));

    await waitFor(() =>
      expect(field('Authenticator code')).toHaveAccessibleDescription(
        expect.stringContaining('That code is not right.'),
      ),
    );
    expect(field('Authenticator code')).toHaveValue('');
    expect(field('Authenticator code')).toHaveFocus();
    expect(field('New password')).toHaveValue(PASSWORD);
  });

  it('says when the link no longer works, when it is opened', async () => {
    const { api } = invitation({
      [OPEN]: () =>
        json(400, { message: 'Invalid or expired invitation link' }),
    });

    expect(
      await screen.findByText('This link no longer works'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'It has been used already, it has ended, or a newer email replaced it. Ask a Super User to send you a new one.',
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.to('POST', '/v1/staff/auth/setup-link')).toHaveLength(1);
  });

  it('says when the link stopped working while the page was open', async () => {
    const { user } = invitation({
      [ACCEPT]: () =>
        json(400, { message: 'Invalid or expired invitation link' }),
    });
    await fillInvitation(user);

    await user.click(button('Join Herbal Commerce'));

    expect(
      await screen.findByText('This link no longer works'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('figure')).toBeNull();
  });

  it('sends nothing for a link cut short, or with anything but a token in it', async () => {
    for (const path of [
      '/accept-invite',
      '/accept-invite?token=short',
      `/accept-invite?token=${TOKEN.slice(0, 20)}%3Cb%3E`,
    ]) {
      const { api } = openLink(path);
      expect(
        await screen.findByText('This link is not complete'),
      ).toBeInTheDocument();
      expect(api.to('POST', '/v1/staff/auth/setup-link')).toEqual([]);
      document.body.innerHTML = '';
    }
  });

  it('says to wait after too many tries, and tries again when asked', async () => {
    const { user } = invitation({
      [OPEN]: [
        () =>
          json(429, { message: 'Too Many Requests' }, { 'Retry-After': '120' }),
        () => json(200, INVITATION),
      ],
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many tries. Wait 2 minutes and try again.',
    );
    await user.click(button('Try again'));

    expect(
      await screen.findByRole('heading', { name: 'Welcome, Dev Patel' }),
    ).toBeInTheDocument();
  });

  it('sends once while the answer is on its way', async () => {
    const answer = heldBack();
    const { user, api } = invitation({ [ACCEPT]: answer.answer });
    await fillInvitation(user);

    await user.click(button('Join Herbal Commerce'));
    await user.click(button('Setting up…'));
    // Enter in a field sends the form too, and so may anything else.
    await user.type(field('Authenticator code'), '{Enter}');
    fireEvent.submit(button('Setting up…').closest('form') as HTMLFormElement);

    expect(api.to('POST', '/v1/staff/auth/accept-invite')).toHaveLength(1);
    await act(async () => answer.release(json(200, { message: 'set' })));
    expect(
      await screen.findByRole('link', { name: 'Go to sign in' }),
    ).toBeInTheDocument();
  });

  it('copies the key without its spaces', async () => {
    const { user } = invitation();
    await screen.findByRole('heading', { name: 'Welcome, Dev Patel' });

    await user.click(button('Copy the key'));

    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe(INVITATION.key);
  });

  it('shows the passwords when asked, both at once', async () => {
    const { user } = invitation();
    await screen.findByRole('heading', { name: 'Welcome, Dev Patel' });

    await user.click(button('Show password'));

    expect(field('New password')).toHaveAttribute('type', 'text');
    expect(field('The same password again')).toHaveAttribute('type', 'text');
    expect(button('Hide password')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('setting up the authenticator app again', () => {
  it('asks for the password the Admin already has, and sends it to its own address', async () => {
    const { user, api } = reset({
      [AGAIN]: () =>
        json(200, {
          message: 'Your authenticator app is set. Sign in with it.',
        }),
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Set up your authenticator app again',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A Super User reset your authenticator app/),
    ).toBeInTheDocument();
    expect(field('Password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.queryByLabelText('The same password again')).toBeNull();
    await user.type(field('Password'), 'an older shorter one');
    await user.type(field('Authenticator code'), '654321');
    await user.click(button('Set up the app'));

    expect(
      await screen.findByText(
        'Your authenticator app is set. Sign in with your password and a code from it.',
      ),
    ).toBeInTheDocument();
    expect(
      api.to('POST', '/v1/staff/auth/reset-authenticator').map((r) => r.body),
    ).toEqual([
      { token: TOKEN, password: 'an older shorter one', code: '654321' },
    ]);
    expect(api.to('POST', '/v1/staff/auth/accept-invite')).toEqual([]);
  });

  it('never says whether the password or the code was wrong, and keeps neither', async () => {
    const { user } = reset({
      [AGAIN]: () => json(401, { message: 'Invalid password or code' }),
    });
    await screen.findByRole('heading', {
      name: 'Set up your authenticator app again',
    });
    await user.type(field('Password'), 'a wrong password');
    await user.type(field('Authenticator code'), '654321');

    await user.click(button('Set up the app'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password or the code is not right.',
    );
    expect(field('Password')).toHaveValue('');
    expect(field('Authenticator code')).toHaveValue('');
    expect(field('Password')).toHaveFocus();
  });

  it('asks for the password before sending', async () => {
    const { user, api } = reset();
    await screen.findByRole('heading', {
      name: 'Set up your authenticator app again',
    });

    await user.type(field('Authenticator code'), '654321');
    await user.click(button('Set up the app'));

    expect(field('Password')).toHaveAccessibleDescription(
      expect.stringContaining('Enter your password'),
    );
    expect(api.to('POST', '/v1/staff/auth/reset-authenticator')).toEqual([]);
  });

  it('follows the link itself, whichever page it was opened on', async () => {
    openLink(`/accept-invite?token=${TOKEN}`, {
      [OPEN]: () => json(200, RESET),
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Set up your authenticator app again',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('button', {
        name: 'Set up the app',
      }),
    ).toBeInTheDocument();
  });
});
