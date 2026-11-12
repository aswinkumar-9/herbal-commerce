import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { routes } from './App';
import { accessToken } from './api/access-token';
import { IDLE_LIMIT_MS, IDLE_WARNING_MS } from './auth/idle';
import { fetchProfile } from './auth/staff-api';
import { ASHA, RAVI, fakeApi, json, offline, tokens } from './test/fake-api';

const REFRESH = 'POST /v1/staff/auth/refresh';
const LOGIN = 'POST /v1/staff/auth/login';
const LOGOUT = 'POST /v1/staff/auth/logout';
const ME = 'GET /v1/staff/me';

const noSession = () => json(401, { message: 'Invalid refresh token' });
const session =
  (token = 't1') =>
  () =>
    json(200, tokens(token));
const PASSWORD = 'a-long-staff-password';

function openConsole(
  path: string | { pathname: string; state: unknown } = '/',
  { strict = false } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { user: userEvent.setup(), queryClient };
}

async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  { email = 'asha@example.com', password = PASSWORD, code = '123456' } = {},
) {
  await screen.findByRole('heading', { name: 'Sign in' });
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.type(screen.getByLabelText('Authenticator code'), code);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

// Another tab of the console, as far as this one can tell.
const TABS = 'herbal-staff-session';

function listenToOtherTabs() {
  const messages: unknown[] = [];
  const tab = new BroadcastChannel(TABS);
  tab.onmessage = (event: MessageEvent) => messages.push(event.data);
  return { messages, close: () => tab.close() };
}

function tellThisTab(message: string) {
  const tab = new BroadcastChannel(TABS);
  tab.postMessage(message);
  tab.close();
}

describe('signing in', () => {
  it('opens the sign-in page when there is no session', async () => {
    fakeApi({ [REFRESH]: noSession });
    openConsole('/');

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Sign in · Herbal Commerce Admin');
  });

  it('checks the form before anything is sent', async () => {
    const api = fakeApi({ [REFRESH]: noSession });
    const { user } = openConsole('/');
    await screen.findByRole('heading', { name: 'Sign in' });

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(
      screen.getByText('Enter the 6-digit code from your authenticator app'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    await user.type(screen.getByLabelText('Email'), 'asha@');
    await user.type(screen.getByLabelText('Authenticator code'), 'ab12 34x567');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    // Only digits, and only six of them.
    expect(screen.getByLabelText('Authenticator code')).toHaveValue('123456');
    expect(api.to('POST', '/v1/staff/auth/login')).toHaveLength(0);
  });

  it('signs in with the email, password and code, and opens the page staff asked for', async () => {
    const api = fakeApi({
      [REFRESH]: noSession,
      [LOGIN]: session('t1'),
      [ME]: () => json(200, ASHA),
    });
    const { user } = openConsole('/orders');

    await signIn(user, { email: '  Asha@Example.com ' });

    expect(
      await screen.findByRole('heading', { name: 'Orders' }),
    ).toBeInTheDocument();
    const [login] = api.to('POST', '/v1/staff/auth/login');
    expect(login?.body).toEqual({
      email: 'asha@example.com',
      password: PASSWORD,
      code: '123456',
    });
    expect(login?.authorization).toBeNull();
    expect(api.to('GET', '/v1/staff/me')[0]?.authorization).toBe('Bearer t1');
    expect(api.unexpected).toEqual([]);
  });

  it('says only that the details are wrong, and clears the password and the code', async () => {
    fakeApi({
      [REFRESH]: noSession,
      [LOGIN]: () => json(401, { message: 'Invalid email, password or code' }),
    });
    const { user } = openConsole('/');

    await signIn(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email, password or code is not right.',
    );
    expect(screen.getByLabelText('Email')).toHaveValue('asha@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Authenticator code')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('says how long to wait after too many attempts', async () => {
    fakeApi({
      [REFRESH]: noSession,
      [LOGIN]: () =>
        json(
          429,
          {
            message: 'Too many requests. Please try again later.',
            code: 'RATE_LIMITED',
          },
          { 'Retry-After': '120' },
        ),
    });
    const { user } = openConsole('/');

    await signIn(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 2 minutes.',
    );
    expect(screen.getByLabelText('Password')).toHaveValue(PASSWORD);
    expect(screen.getByLabelText('Authenticator code')).toHaveValue('');
  });

  it('asks for all 6 digits of the code', async () => {
    const api = fakeApi({ [REFRESH]: noSession });
    const { user } = openConsole('/');

    await signIn(user, { code: '12345' });

    expect(
      screen.getByText('Enter the 6-digit code from your authenticator app'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Authenticator code')).toHaveFocus();
    expect(api.to('POST', '/v1/staff/auth/login')).toHaveLength(0);
  });

  it('never sends staff to another site after signing in', async () => {
    fakeApi({
      [REFRESH]: noSession,
      [LOGIN]: session('t1'),
      [ME]: () => json(200, ASHA),
    });
    const { user } = openConsole({
      pathname: '/sign-in',
      state: { from: '//elsewhere.example/phish' },
    });

    await signIn(user);

    expect(
      await screen.findByRole('heading', { name: 'Welcome, Asha' }),
    ).toBeInTheDocument();
  });

  it('tells the other tabs, which pick the session up', async () => {
    fakeApi({
      [REFRESH]: noSession,
      [LOGIN]: session('t1'),
      [ME]: () => json(200, ASHA),
    });
    const heard = listenToOtherTabs();
    const { user } = openConsole('/');

    await signIn(user);

    await screen.findByRole('heading', { name: 'Welcome, Asha' });
    await vi.waitFor(() => expect(heard.messages).toEqual(['signed-in']));
    heard.close();
  });

  it('picks up a session another tab signed in to', async () => {
    fakeApi({
      [REFRESH]: [noSession, session('t2')],
      [ME]: () => json(200, ASHA),
    });
    openConsole('/');
    await screen.findByRole('heading', { name: 'Sign in' });

    tellThisTab('signed-in');

    expect(
      await screen.findByRole('heading', { name: 'Welcome, Asha' }),
    ).toBeInTheDocument();
    expect(accessToken()).toBe('t2');
  });

  it('says so when the server cannot be reached', async () => {
    fakeApi({ [REFRESH]: noSession, [LOGIN]: offline });
    const { user } = openConsole('/');

    await signIn(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "can't reach the server",
    );
  });

  it('shows the password only when asked', async () => {
    fakeApi({ [REFRESH]: noSession });
    const { user } = openConsole('/');
    await screen.findByRole('heading', { name: 'Sign in' });

    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password',
    );
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password',
    );
  });
});

describe('staying signed in', () => {
  it('comes back signed in after a reload, through the cookie', async () => {
    const api = fakeApi({
      [REFRESH]: session('t1'),
      [ME]: () => json(200, ASHA),
    });
    openConsole('/');

    expect(
      await screen.findByRole('heading', { name: 'Welcome, Asha' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Asha Verma')).toBeInTheDocument();
    expect(api.to('GET', '/v1/staff/me')[0]?.authorization).toBe('Bearer t1');
  });

  it('renews only once, even when React starts the console twice', async () => {
    const api = fakeApi({
      [REFRESH]: session('t1'),
      [ME]: () => json(200, ASHA),
    });
    openConsole('/', { strict: true });

    await screen.findByRole('heading', { name: 'Welcome, Asha' });
    // A second renewal would send a swapped refresh token, and the API
    // would end the session.
    expect(api.to('POST', '/v1/staff/auth/refresh')).toHaveLength(1);
  });

  it('offers to try again when the server cannot be reached', async () => {
    fakeApi({
      [REFRESH]: [offline, session('t1')],
      [ME]: () => json(200, ASHA),
    });
    const { user } = openConsole('/');

    await screen.findByRole('heading', { name: "The server can't be reached" });
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { name: 'Welcome, Asha' }),
    ).toBeInTheDocument();
  });

  it('returns to sign-in, saying why, when the session ends while in use', async () => {
    fakeApi({
      [REFRESH]: [session('t1'), noSession],
      [ME]: [
        () => json(200, ASHA),
        () => json(401, { message: 'Invalid or expired access token' }),
      ],
    });
    const { queryClient } = openConsole('/');
    await screen.findByRole('heading', { name: 'Welcome, Asha' });
    queryClient.setQueryData(['orders'], ['a staff-only order']);

    await act(() => fetchProfile().catch(() => undefined));

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session ended. Please sign in again.',
    );
    expect(queryClient.getQueryData(['orders'])).toBeUndefined();
    expect(accessToken()).toBeNull();
  });
});

describe('roles', () => {
  it('shows an Admin only what Admins use', async () => {
    fakeApi({ [REFRESH]: session(), [ME]: () => json(200, ASHA) });
    openConsole('/');

    const menu = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Overview', 'CatalogSoon', 'StockSoon', 'OrdersSoon']);
    expect(screen.getByText('Admin', { selector: 'span' })).toBeInTheDocument();
  });

  it('keeps Super User pages from an Admin who types the address', async () => {
    fakeApi({ [REFRESH]: session(), [ME]: () => json(200, ASHA) });
    openConsole('/audit-log');

    expect(
      await screen.findByRole('heading', {
        name: 'Only Super Users can open this page',
      }),
    ).toBeInTheDocument();
  });

  it('shows a Super User the Admins and the audit log', async () => {
    fakeApi({ [REFRESH]: session(), [ME]: () => json(200, RAVI) });
    openConsole('/admins');

    expect(
      await screen.findByRole('heading', { name: 'Admins' }),
    ).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main' });
    expect(within(menu).getByRole('link', { name: /Admins/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(menu).getByRole('link', { name: /Audit log/ }),
    ).toBeInTheDocument();
  });

  it('has a page for addresses that lead nowhere', async () => {
    fakeApi({ [REFRESH]: session(), [ME]: () => json(200, ASHA) });
    openConsole('/nowhere');

    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('ends the session on the server, forgets everything, and returns to sign-in', async () => {
    const api = fakeApi({
      [REFRESH]: session('t1'),
      [ME]: () => json(200, ASHA),
      [LOGOUT]: () => json(204),
    });
    const heard = listenToOtherTabs();
    const { user, queryClient } = openConsole('/');
    await screen.findByRole('heading', { name: 'Welcome, Asha' });
    queryClient.setQueryData(['orders'], ['a staff-only order']);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    // The other tabs sign out too.
    await vi.waitFor(() => expect(heard.messages).toEqual(['signed-out']));
    heard.close();

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    const [logout] = api.to('POST', '/v1/staff/auth/logout');
    // The cookie carries the refresh token; nothing else is needed.
    expect(logout?.authorization).toBeNull();
    expect(logout?.body).toBeUndefined();
    expect(accessToken()).toBeNull();
    expect(queryClient.getQueryData(['orders'])).toBeUndefined();
  });

  it('stays signed in, and says so, when sign-out cannot reach the server', async () => {
    fakeApi({
      [REFRESH]: session('t1'),
      [ME]: () => json(200, ASHA),
      [LOGOUT]: offline,
    });
    const { user } = openConsole('/');
    await screen.findByRole('heading', { name: 'Welcome, Asha' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't sign out: the server can't be reached. Try again.",
    );
    expect(
      screen.getByRole('heading', { name: 'Welcome, Asha' }),
    ).toBeInTheDocument();
    expect(accessToken()).toBe('t1');
  });

  it('signs this tab out when another tab signs out', async () => {
    fakeApi({ [REFRESH]: session('t1'), [ME]: () => json(200, ASHA) });
    openConsole('/');
    await screen.findByRole('heading', { name: 'Welcome, Asha' });

    tellThisTab('signed-out');

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'You signed out in another tab.',
    );
    expect(accessToken()).toBeNull();
  });
});

describe('signing out after 30 idle minutes', () => {
  const MINUTE = 60_000;
  const PENDING = 'herbal-staff-sign-out-pending';

  // The clock is ours; it still moves with real time, so the page can load.
  // React's own scheduling (setImmediate) stays real, so the console's
  // timers start as soon as it shows.
  async function signedInWithOurClock(
    logout: () => Response | Error = () => json(204),
  ) {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
      ],
    });
    const api = fakeApi({
      [REFRESH]: session('t1'),
      [ME]: () => json(200, ASHA),
      [LOGOUT]: logout,
    });
    openConsole('/');
    await screen.findByRole('heading', { name: 'Welcome, Asha' });
    // The page shows before its effects run: let the idle timer start.
    await act(() => new Promise((done) => setTimeout(done, 50)));
    return api;
  }

  const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  function anotherTabWasActive(at: number) {
    const tab = new BroadcastChannel('herbal-staff-activity');
    tab.postMessage({ at });
    tab.close();
    // The message arrives on a later turn.
    return act(() => new Promise((done) => setTimeout(done, 50)));
  }

  it('waits 30 minutes, as the owner chose', () => {
    expect(IDLE_LIMIT_MS).toBe(30 * MINUTE);
    expect(IDLE_WARNING_MS).toBe(MINUTE);
  });

  it('warns a minute before, then ends the session and says why', async () => {
    const api = await signedInWithOurClock();
    const heard = listenToOtherTabs();

    await pass(IDLE_LIMIT_MS - IDLE_WARNING_MS);
    expect(screen.getByText('Still there?')).toBeInTheDocument();
    expect(screen.getByText(/^(1:00|0:59)$/)).toBeInTheDocument();
    expect(api.to('POST', '/v1/staff/auth/logout')).toHaveLength(0);

    await pass(IDLE_WARNING_MS);

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'You were signed out after 30 minutes without activity.',
    );
    expect(api.to('POST', '/v1/staff/auth/logout')).toHaveLength(1);
    expect(accessToken()).toBeNull();
    // The other tabs sign out too, and say why.
    await vi.waitFor(() => expect(heard.messages).toEqual(['signed-out-idle']));
    heard.close();
  });

  it('tells the other tabs that staff are active', async () => {
    await signedInWithOurClock();
    const heard: unknown[] = [];
    const tab = new BroadcastChannel('herbal-staff-activity');
    tab.onmessage = (event: MessageEvent) => heard.push(event.data);

    await pass(MINUTE);
    fireEvent.keyDown(document.body, { key: 'a' });

    await vi.waitFor(() => expect(heard).toEqual([{ at: expect.any(Number) }]));
    tab.close();
  });

  it('starts the time again with any key or click', async () => {
    const api = await signedInWithOurClock();

    await pass(20 * MINUTE);
    fireEvent.keyDown(document.body, { key: 'a' });
    await pass(20 * MINUTE);
    fireEvent.pointerDown(document.body);
    await pass(20 * MINUTE);

    expect(
      screen.getByRole('heading', { name: 'Welcome, Asha' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Still there?')).not.toBeInTheDocument();
    expect(api.to('POST', '/v1/staff/auth/logout')).toHaveLength(0);
  });

  it('keeps staff signed in from the warning', async () => {
    const api = await signedInWithOurClock();
    await pass(IDLE_LIMIT_MS - 30_000);

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await vi.waitFor(() =>
      expect(screen.queryByText('Still there?')).not.toBeInTheDocument(),
    );
    await pass(10 * MINUTE);

    expect(api.to('POST', '/v1/staff/auth/logout')).toHaveLength(0);
  });

  it('counts activity in another tab of the console', async () => {
    const api = await signedInWithOurClock();

    await pass(20 * MINUTE);
    await anotherTabWasActive(Date.now());
    await pass(20 * MINUTE);

    expect(screen.queryByText('Still there?')).not.toBeInTheDocument();
    expect(api.to('POST', '/v1/staff/auth/logout')).toHaveLength(0);
  });

  it('never counts activity from the future', async () => {
    const api = await signedInWithOurClock();

    await anotherTabWasActive(Date.now() + 24 * 60 * MINUTE);
    await pass(IDLE_LIMIT_MS);

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(api.to('POST', '/v1/staff/auth/logout')).toHaveLength(1);
  });

  it('signs out at once when a computer wakes after a long sleep', async () => {
    const api = await signedInWithOurClock();

    // Asleep: no timer ran, but the clock moved on.
    vi.setSystemTime(Date.now() + IDLE_LIMIT_MS + MINUTE);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // At once, as the page shows again: not at the next tick of the timer.
    expect(api.to('POST', '/v1/staff/auth/logout')).toHaveLength(1);
    await screen.findByRole('heading', { name: 'Sign in' });
  });

  it('locks the console even when the server cannot be reached, and ends the session at the next start', async () => {
    await signedInWithOurClock(offline);

    await pass(IDLE_LIMIT_MS);

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(accessToken()).toBeNull();
    expect(localStorage.getItem(PENDING)).toBe('1');

    // The next start: the session ends before anything else.
    cleanup();
    vi.useRealTimers();
    const api = fakeApi({
      [LOGOUT]: () => json(204),
      [REFRESH]: session('t2'),
      [ME]: () => json(200, ASHA),
    });
    openConsole('/');

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(api.to('POST', '/v1/staff/auth/logout')).toHaveLength(1);
    expect(api.to('POST', '/v1/staff/auth/refresh')).toHaveLength(0);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it("says why when another tab's idle sign-out signs this tab out", async () => {
    fakeApi({ [REFRESH]: session('t1'), [ME]: () => json(200, ASHA) });
    openConsole('/');
    await screen.findByRole('heading', { name: 'Welcome, Asha' });

    tellThisTab('signed-out-idle');

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'You were signed out after 30 minutes without activity.',
    );
  });
});
