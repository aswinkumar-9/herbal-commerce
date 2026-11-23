import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MetaDescriptor } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../test/render.tsx';
import SignInPage, { meta } from './sign-in.tsx';
import type { SignInProblems } from './sign-in.tsx';

const ORIGIN = 'http://localhost:3001';

function openSignIn({
  next = null,
  ended = null,
  refuse,
}: {
  next?: string | null;
  ended?: 'password' | 'everywhere' | null;
  refuse?: { email: string; problems: SignInProblems };
} = {}) {
  const sentForms: FormData[] = [];
  renderPage({
    path: '/sign-in',
    Component: SignInPage as never,
    loader: () => ({ next, ended, origin: ORIGIN }),
    action: async ({ request }) => {
      sentForms.push(await request.formData());
      return refuse ?? null;
    },
  });
  return { sentForms, user: userEvent.setup() };
}

const emailBox = () => screen.getByLabelText('Email address');
const passwordBox = () => screen.getByLabelText('Password');

describe('the sign-in page', () => {
  it('asks for an email address and a password, as password managers expect', async () => {
    openSignIn();

    expect(
      await screen.findByRole('heading', { name: 'Sign in', level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Welcome back. Sign in to see your account.'),
    ).toBeInTheDocument();
    expect(emailBox()).toHaveAttribute('type', 'email');
    expect(emailBox()).toHaveAttribute('autocomplete', 'email');
    expect(emailBox()).toBeRequired();
    expect(passwordBox()).toHaveAttribute('type', 'password');
    expect(passwordBox()).toHaveAttribute('autocomplete', 'current-password');
    expect(passwordBox()).toBeRequired();
    const form = emailBox().closest('form') as HTMLFormElement;
    expect(form.method).toBe('post');
    expect(
      within(form).getByRole('button', { name: 'Sign in' }),
    ).toHaveAttribute('type', 'submit');
  });

  it('shows the password as typed when asked', async () => {
    const { user } = openSignIn();
    await screen.findByRole('heading', { name: 'Sign in' });

    await user.click(screen.getByRole('checkbox', { name: 'Show password' }));
    expect(passwordBox()).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('checkbox', { name: 'Show password' }));
    expect(passwordBox()).toHaveAttribute('type', 'password');
  });

  it('sends the form, with the page to come back to', async () => {
    const { user, sentForms } = openSignIn({ next: '/shop?q=neem' });
    expect(
      await screen.findByText('Sign in to see that page.'),
    ).toBeInTheDocument();

    await user.type(emailBox(), 'asha@example.com');
    await user.type(passwordBox(), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(Object.fromEntries(sentForms[0] as FormData)).toEqual({
      next: '/shop?q=neem',
      email: 'asha@example.com',
      password: 'a long password',
    });
  });

  it('says beside each field what to fix, and puts the keyboard on the first', async () => {
    const { user } = openSignIn({
      refuse: {
        email: 'asha@example',
        problems: {
          email: 'Enter an email address like name@example.com.',
          password: 'Enter your password.',
        },
      },
    });
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(emailBox(), 'asha@example');
    await user.type(passwordBox(), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(emailBox()).toHaveFocus());
    expect(emailBox()).toHaveAttribute('aria-invalid', 'true');
    expect(emailBox()).toHaveAccessibleDescription(
      'Enter an email address like name@example.com.',
    );
    expect(passwordBox()).toHaveAccessibleDescription('Enter your password.');
    // The address stays; the password goes.
    expect(emailBox()).toHaveValue('asha@example');
    expect(passwordBox()).toHaveValue('');
  });

  it('says what went wrong with the whole form, with its hint, and reads it out', async () => {
    const { user } = openSignIn({
      refuse: {
        email: 'asha@example.com',
        problems: {
          form: 'The email address or the password is not right. Please check them and try again.',
          hint: 'Signed up recently? Confirm your email address first, with the link we sent you.',
        },
      },
    });
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(emailBox(), 'asha@example.com');
    await user.type(passwordBox(), 'a wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The email address or the password is not right.',
    );
    expect(alert).toHaveTextContent('Signed up recently?');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('asks search engines not to list it', () => {
    const tags = meta({
      loaderData: { next: null, origin: ORIGIN },
    } as unknown as Parameters<typeof meta>[0]) as MetaDescriptor[];
    expect(tags).toContainEqual({ title: 'Sign in · Herbal Commerce' });
    expect(tags).toContainEqual({ name: 'robots', content: 'noindex, follow' });
  });
});

describe('the sign-in page after signing out on purpose', () => {
  it('says the password is changed and every device signed out', async () => {
    openSignIn({ ended: 'password' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your password is changed, and you are signed out on every device. Sign in with the new password.',
    );
  });

  it('says every device is signed out', async () => {
    openSignIn({ ended: 'everywhere' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You are signed out on every device.',
    );
  });

  it('says nothing of the kind otherwise', async () => {
    openSignIn();
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
