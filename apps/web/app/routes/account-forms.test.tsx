import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../test/render.tsx';
import ForgotPasswordPage from './forgot-password.tsx';
import ResetPasswordPage from './reset-password.tsx';
import SignInPage from './sign-in.tsx';
import SignUpPage from './sign-up.tsx';
import VerifyEmailPage from './verify-email.tsx';

const ORIGIN = 'http://localhost:3001';
const TOKEN = 'Zm9yIGEgdGVzdCBvbmx5IG5vdCBhIHJlYWwgdG9rZW4';

// Draws a form page whose action keeps what it was sent and gives back
// the answer the test chose.
function open({
  path,
  url = path,
  Component,
  loaderData,
  answer = null,
}: {
  path: string;
  url?: string;
  Component: unknown;
  loaderData: unknown;
  answer?: unknown;
}) {
  const sentForms: Record<string, unknown>[] = [];
  renderPage({
    path,
    url,
    Component: Component as never,
    loader: () => loaderData,
    action: async ({ request }) => {
      sentForms.push(Object.fromEntries(await request.formData()));
      return answer;
    },
  });
  return { sentForms, user: userEvent.setup() };
}

const linkTo = (name: string) =>
  screen.getByRole('link', { name }).getAttribute('href');

describe('the sign-in page’s ways on', () => {
  it('leads to a forgotten password and to a new account', async () => {
    open({
      path: '/sign-in',
      Component: SignInPage,
      loaderData: { next: null, origin: ORIGIN },
    });
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(linkTo('Forgot your password?')).toBe('/forgot-password');
    expect(linkTo('Create an account')).toBe('/sign-up');
  });

  it('offers a new confirmation link beside the hint', async () => {
    const { user } = open({
      path: '/sign-in',
      Component: SignInPage,
      loaderData: { next: null, origin: ORIGIN },
      answer: {
        email: 'asha@example.com',
        problems: { form: 'Not right.', hint: 'Signed up recently?' },
      },
    });
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Email address'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'a password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByRole('alert');
    expect(
      within(alert)
        .getByRole('link', { name: 'Send the link again' })
        .getAttribute('href'),
    ).toBe('/verify-email');
  });
});

describe('the sign-up page', () => {
  const openSignUp = (answer: unknown = null) =>
    open({
      path: '/sign-up',
      Component: SignUpPage,
      loaderData: { origin: ORIGIN },
      answer,
    });

  it('asks for a name, an email address and a new password, as password managers expect', async () => {
    openSignUp();
    expect(
      await screen.findByRole('heading', {
        name: 'Create an account',
        level: 1,
      }),
    ).toBeInTheDocument();
    const name = screen.getByLabelText('Your name');
    expect(name).toHaveAttribute('autocomplete', 'name');
    expect(name).toBeRequired();
    const email = screen.getByLabelText('Email address');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toHaveAttribute('minlength', '10');
    expect(password).toHaveAccessibleDescription('At least 10 characters.');
  });

  it('names the terms and the privacy policy, and leads to sign in', async () => {
    openSignUp();
    await screen.findByRole('heading', { name: 'Create an account' });
    expect(
      screen.getByText(/By creating an account, you agree to the/),
    ).toHaveTextContent(
      'By creating an account, you agree to the Terms and conditions and the Privacy policy.',
    );
    expect(linkTo('Terms and conditions')).toBe('/terms');
    expect(linkTo('Privacy policy')).toBe('/privacy');
    expect(linkTo('Sign in')).toBe('/sign-in');
  });

  it('sends the form', async () => {
    const { user, sentForms } = openSignUp();
    await screen.findByRole('heading', { name: 'Create an account' });
    await user.type(screen.getByLabelText('Your name'), 'Asha Verma');
    await user.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(sentForms[0]).toEqual({
      fullName: 'Asha Verma',
      email: 'asha@example.com',
      password: 'a long password',
    });
  });

  it('says beside each field what to fix, keyboard on the first, password cleared', async () => {
    const { user } = openSignUp({
      fullName: 'Asha Verma',
      email: 'asha@example.com',
      problems: { password: 'Choose a password with at least 10 characters.' },
    });
    await screen.findByRole('heading', { name: 'Create an account' });
    await user.type(screen.getByLabelText('Your name'), 'Asha Verma');
    await user.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'too short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const password = screen.getByLabelText('Password');
    await waitFor(() => expect(password).toHaveFocus());
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAccessibleDescription(
      'At least 10 characters. Choose a password with at least 10 characters.',
    );
    expect(password).toHaveValue('');
    expect(screen.getByLabelText('Your name')).toHaveValue('Asha Verma');
  });

  it('then says to check the inbox, with the heading in focus', async () => {
    const { user } = openSignUp({ done: true, email: 'asha@example.com' });
    await screen.findByRole('heading', { name: 'Create an account' });
    await user.type(screen.getByLabelText('Your name'), 'Asha Verma');
    await user.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const heading = await screen.findByRole('heading', {
      name: 'Check your inbox',
      level: 1,
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.getByText(
        'We have sent a message to asha@example.com. Open it to finish.',
      ),
    ).toBeInTheDocument();
    expect(linkTo('send the link again')).toBe('/verify-email');
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});

describe('the page of the confirmation link', () => {
  const openVerify = ({
    token = TOKEN as string | null,
    broken = false,
    answer = null as unknown,
  } = {}) =>
    open({
      path: '/verify-email',
      url: token ? `/verify-email?token=${token}` : '/verify-email',
      Component: VerifyEmailPage,
      loaderData: { token, broken, origin: ORIGIN },
      answer,
    });

  it('shows a button that sends the token, and nothing else to fill in', async () => {
    const { user, sentForms } = openVerify();
    expect(
      await screen.findByRole('heading', {
        name: 'Confirm your email address',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Confirm my email address' }),
    );
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(sentForms[0]).toEqual({ intent: 'confirm', token: TOKEN });
  });

  it('then says it is confirmed, with the heading in focus and the way to sign in', async () => {
    const { user } = openVerify({ answer: { done: true, sentTo: null } });
    await user.click(
      await screen.findByRole('button', { name: 'Confirm my email address' }),
    );
    const heading = await screen.findByRole('heading', {
      name: 'Your email address is confirmed',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(linkTo('Sign in')).toBe('/sign-in');
  });

  it('after a failed link, says why, and offers a new one', async () => {
    const { user, sentForms } = openVerify({
      answer: {
        intent: 'confirm',
        linkFailed: true,
        email: '',
        problems: { form: 'This link has expired or has been used already.' },
      },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Confirm my email address' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This link has expired');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(
      screen.getByRole('heading', { name: 'Send the link again' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeRequired();
    expect(sentForms).toHaveLength(1);
  });

  it('without a link, sends a new one to an address', async () => {
    const { user, sentForms } = openVerify({
      token: null,
      answer: { done: true, sentTo: 'asha@example.com' },
    });
    expect(
      await screen.findByRole('heading', { name: 'Send the link again' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(sentForms[0]).toEqual({
      intent: 'resend',
      email: 'asha@example.com',
    });
    const heading = await screen.findByRole('heading', {
      name: 'Check your inbox',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/If asha@example.com is waiting/)).toBeVisible();
  });

  it('says when a link was cut short', async () => {
    openVerify({ token: null, broken: true });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is not complete.',
    );
  });
});

describe('the forgot password page', () => {
  it('asks for the address, then says to check the inbox', async () => {
    const { user, sentForms } = open({
      path: '/forgot-password',
      Component: ForgotPasswordPage,
      loaderData: { origin: ORIGIN },
      answer: { done: true, email: 'asha@example.com' },
    });
    expect(
      await screen.findByRole('heading', { name: 'Forgot your password?' }),
    ).toBeInTheDocument();
    expect(linkTo('Back to sign in')).toBe('/sign-in');
    await user.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(sentForms[0]).toEqual({ email: 'asha@example.com' });
    const heading = await screen.findByRole('heading', {
      name: 'Check your inbox',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.getByText(
        'If asha@example.com has an account, we have sent it a link to choose a new password.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The link lasts 30 minutes and works once.'),
    ).toBeInTheDocument();
  });
});

describe('the page of the reset link', () => {
  const openReset = ({
    token = TOKEN as string | null,
    answer = null as unknown,
  } = {}) =>
    open({
      path: '/reset-password',
      url: `/reset-password?token=${token ?? 'cut'}`,
      Component: ResetPasswordPage,
      loaderData: { token, origin: ORIGIN },
      answer,
    });

  it('asks for the new password, as password managers expect, and sends it with the token', async () => {
    const { user, sentForms } = openReset({ answer: { done: true } });
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
    const password = screen.getByLabelText('New password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toHaveAttribute('minlength', '10');
    await user.type(password, 'a new long password');
    await user.click(
      screen.getByRole('button', { name: 'Save the new password' }),
    );
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(sentForms[0]).toEqual({
      token: TOKEN,
      password: 'a new long password',
    });
    const heading = await screen.findByRole('heading', {
      name: 'Your password is changed',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(linkTo('Sign in')).toBe('/sign-in');
  });

  it('for a link cut short, says so and leads to a new one, with no box to fill', async () => {
    openReset({ token: null });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is not complete.',
    );
    expect(linkTo('Ask for a new link')).toBe('/forgot-password');
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('after a failed link, says why and leads to a new one', async () => {
    const { user } = openReset({
      answer: {
        linkFailed: true,
        problems: { form: 'This link has expired or has been used already.' },
      },
    });
    await user.type(
      await screen.findByLabelText('New password'),
      'a new long password',
    );
    await user.click(
      screen.getByRole('button', { name: 'Save the new password' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This link has expired');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(linkTo('Ask for a new link')).toBe('/forgot-password');
  });
});
