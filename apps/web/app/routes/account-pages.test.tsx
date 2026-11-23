import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Address } from '../address.ts';
import { renderPage } from '../test/render.tsx';
import PasswordPage from './account-password.tsx';
import AccountPage from './account.tsx';
import EditAddressPage from './address-edit.tsx';
import NewAddressPage from './address-new.tsx';

const ORIGIN = 'http://localhost:3001';
const HOME: Address = {
  id: '0b6f3c1e-8f3a-4c55-9a51-3c2b1d7e9f10',
  fullName: 'Asha Verma',
  phone: '9845012345',
  line1: '12 MG Road',
  line2: 'Near the clock tower',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  isDefault: true,
};
const OFFICE: Address = {
  ...HOME,
  id: '7d0c2b4a-1e2f-4a3b-8c9d-0e1f2a3b4c5d',
  line1: '4 Residency Road',
  line2: null,
  isDefault: false,
};

function openAccount({
  addresses = [HOME, OFFICE],
  saved = null,
  answer = null,
}: {
  addresses?: Address[];
  saved?: string | null;
  answer?: unknown;
} = {}) {
  const sentForms: FormData[] = [];
  renderPage({
    path: '/account',
    Component: AccountPage as never,
    loader: () => ({
      fullName: 'Asha Verma',
      email: 'asha@example.com',
      addresses,
      saved,
      origin: ORIGIN,
    }),
    action: async ({ request }) => {
      sentForms.push(await request.formData());
      return answer;
    },
  });
  return { sentForms, user: userEvent.setup() };
}

const region = (name: string) => screen.getByRole('region', { name });

describe('the account page', () => {
  it('has the way to the orders, the customer’s details, addresses, password and signing out, each under its heading', async () => {
    openAccount();
    expect(
      await screen.findByRole('heading', { name: 'Your account', level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      'Your orders',
      'Your details',
      'Delivery addresses',
      'Password',
      'Signing out',
    ]);
    const details = region('Your details');
    expect(within(details).getByLabelText('Your name')).toHaveValue(
      'Asha Verma',
    );
    expect(within(details).getByLabelText('Your name')).toHaveAttribute(
      'autocomplete',
      'name',
    );
    expect(details).toHaveTextContent('asha@example.com');
    expect(
      within(region('Your orders')).getByRole('link', {
        name: 'See your orders',
      }),
    ).toHaveAttribute('href', '/orders');
  });

  it('lists the addresses, the default first and marked, each with its own way to change it', async () => {
    openAccount();
    const list = within(
      await screen.findByRole('region', { name: 'Delivery addresses' }),
    ).getAllByRole('listitem');
    expect(list).toHaveLength(2);
    expect(list[0]).toHaveTextContent('Default');
    expect(list[0]).toHaveTextContent(
      '12 MG RoadNear the clock towerBengaluru, Karnataka 560001Phone 98450 12345',
    );
    expect(list[1]).not.toHaveTextContent('Default');

    // Each button and link says which address it is for.
    expect(
      within(list[0] as HTMLElement).getByRole('link', {
        name: 'Edit the address for Asha Verma, 12 MG Road',
      }),
    ).toHaveAttribute('href', `/account/addresses/${HOME.id}`);
    expect(
      within(list[0] as HTMLElement).queryByRole('button', {
        name: /Make default/,
      }),
    ).toBeNull();
    expect(
      within(list[1] as HTMLElement).getByRole('button', {
        name: 'Make default, the address for Asha Verma, 4 Residency Road',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Add an address' }),
    ).toHaveAttribute('href', '/account/addresses/new');
  });

  it('makes an address the default by a form, never a link', async () => {
    const { sentForms, user } = openAccount({
      answer: { saved: 'default', problems: {}, fullName: null },
    });
    await user.click(
      await screen.findByRole('button', { name: /^Make default/ }),
    );
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(Object.fromEntries(sentForms[0] as FormData)).toEqual({
      intent: 'default',
      id: OFFICE.id,
    });
    // What was done is said, and the keyboard goes to it.
    const said = await screen.findByRole('status');
    expect(said).toHaveTextContent('Your default address is changed.');
    expect(said).toHaveFocus();
  });

  it('says when there are none yet, and when there are 10, the most kept', async () => {
    openAccount({ addresses: [] });
    expect(
      await screen.findByText('No delivery addresses saved yet.'),
    ).toBeInTheDocument();
  });

  it('offers no new address once there are 10', async () => {
    openAccount({
      addresses: Array.from({ length: 10 }, (_, n) => ({
        ...OFFICE,
        id: `7d0c2b4a-1e2f-4a3b-8c9d-0e1f2a3b4c${String(n).padStart(2, '0')}`,
      })),
    });
    expect(
      await screen.findByText(
        'You have 10 addresses, the most we keep. Remove one to add another.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add an address' })).toBeNull();
  });

  it('says what was done on an address page, and the keyboard goes to it', async () => {
    openAccount({ saved: 'removed' });
    const said = await screen.findByRole('status');
    expect(said).toHaveTextContent('The address is removed.');
    await waitFor(() => expect(said).toHaveFocus());
  });

  it('saves the name, and on a problem the keyboard goes to the box', async () => {
    const { sentForms, user } = openAccount({
      answer: {
        saved: null,
        problems: { fullName: 'Enter your name.' },
        fullName: '',
      },
    });
    const box = await screen.findByLabelText('Your name');
    await user.clear(box);
    await user.type(box, 'Asha K');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(Object.fromEntries(sentForms[0] as FormData)).toEqual({
      intent: 'name',
      fullName: 'Asha K',
    });
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Your name')).toHaveFocus(),
    );
  });

  it('signs out here by the sign-out form, and everywhere by this page’s own', async () => {
    const { sentForms, user } = openAccount({
      answer: {
        saved: null,
        problems: {
          form: 'We could not sign you out everywhere just now. Please try again in a minute.',
        },
        fullName: null,
      },
    });
    const out = await screen.findByRole('region', { name: 'Signing out' });
    const here = within(out).getByRole('button', { name: 'Sign out' });
    expect(here.closest('form')?.getAttribute('action')).toBe('/sign-out');
    expect(screen.queryByRole('link', { name: /Sign out/ })).toBeNull();

    await user.click(
      within(out).getByRole('button', { name: 'Sign out everywhere' }),
    );
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(Object.fromEntries(sentForms[0] as FormData)).toEqual({
      intent: 'everywhere',
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not sign you out everywhere');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('leads to a new password', async () => {
    openAccount();
    expect(
      within(await screen.findByRole('region', { name: 'Password' })).getByRole(
        'link',
        { name: 'Change password' },
      ),
    ).toHaveAttribute('href', '/account/password');
  });
});

describe('the password page', () => {
  it('asks for the current and the new password, as password managers expect', async () => {
    renderPage({
      path: '/account/password',
      Component: PasswordPage as never,
      loader: () => ({ email: 'asha@example.com', origin: ORIGIN }),
    });
    expect(
      await screen.findByRole('heading', { name: 'Change your password' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Changing it signs you out on every device, this one too. Then sign in with the new password.',
      ),
    ).toBeInTheDocument();
    const current = screen.getByLabelText('Current password');
    const fresh = screen.getByLabelText('New password');
    expect(current).toHaveAttribute('type', 'password');
    expect(current).toHaveAttribute('autocomplete', 'current-password');
    expect(fresh).toHaveAttribute('autocomplete', 'new-password');
    expect(fresh).toHaveAttribute('minlength', '10');
    // Whose password it is, for the password manager, never shown.
    const username = document.querySelector('input[autocomplete=username]');
    expect(username).toHaveValue('asha@example.com');
    expect(username).not.toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to your account' }),
    ).toHaveAttribute('href', '/account');
  });
});

describe('the new address page', () => {
  const openNew = (count: number) =>
    renderPage({
      path: '/account/addresses/new',
      Component: NewAddressPage as never,
      loader: () => ({ count, origin: ORIGIN }),
    });

  it('asks for each part of the address, as the browser can fill it in', async () => {
    openNew(2);
    expect(
      await screen.findByRole('heading', { name: 'Add an address' }),
    ).toBeInTheDocument();
    for (const [label, autocomplete] of [
      ['Full name', 'name'],
      ['Mobile number', 'tel-national'],
      ['House number and street', 'address-line1'],
      ['Area or landmark (optional)', 'address-line2'],
      ['City or town', 'address-level2'],
      ['State or union territory', 'address-level1'],
      ['PIN code', 'postal-code'],
    ] as const) {
      expect(screen.getByLabelText(label), label).toHaveAttribute(
        'autocomplete',
        autocomplete,
      );
    }
    expect(
      screen.getByLabelText('Area or landmark (optional)'),
    ).not.toBeRequired();
    expect(screen.getByLabelText('City or town')).toBeRequired();
    const state = screen.getByLabelText('State or union territory');
    // None chosen, then the 36 states and union territories.
    expect(within(state).getAllByRole('option')).toHaveLength(37);
    expect(state).toHaveValue('');
    expect(
      screen.getByRole('checkbox', { name: 'Make this my default address' }),
    ).not.toBeChecked();
  });

  it('says the first address is the default, with nothing to tick', async () => {
    openNew(0);
    expect(
      await screen.findByText('Your first address is your default.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('says when there are 10 already, with no form', async () => {
    openNew(10);
    expect(
      await screen.findByText(
        'You have 10 addresses, the most we keep. Remove one to add another.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add address' })).toBeNull();
  });
});

describe('the address page', () => {
  function openEdit(address: Address, others = 1) {
    const sentForms: FormData[] = [];
    renderPage({
      path: '/account/addresses/:id',
      url: `/account/addresses/${address.id}`,
      Component: EditAddressPage as never,
      loader: () => ({ address, others, origin: ORIGIN }),
      action: async ({ request }) => {
        const form = await request.formData();
        sentForms.push(form);
        return {
          typed: null,
          isDefault: false,
          problems: {},
          confirming: form.get('intent') === 'remove',
        };
      },
    });
    return { sentForms, user: userEvent.setup() };
  }

  it('has the address in the form, the phone as people read it', async () => {
    openEdit(OFFICE);
    expect(await screen.findByLabelText('Full name')).toHaveValue('Asha Verma');
    expect(screen.getByLabelText('Mobile number')).toHaveValue('98450 12345');
    expect(screen.getByLabelText('Area or landmark (optional)')).toHaveValue(
      '',
    );
    expect(screen.getByLabelText('State or union territory')).toHaveValue(
      'Karnataka',
    );
    expect(
      screen.getByRole('checkbox', { name: 'Make this my default address' }),
    ).toBeInTheDocument();
  });

  it('says the default is the default, with nothing to tick', async () => {
    openEdit(HOME);
    expect(
      await screen.findByText('This is your default address.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('asks once more before removing, and the keyboard goes to the question', async () => {
    const { sentForms, user } = openEdit(HOME);
    await user.click(
      await screen.findByRole('button', { name: 'Remove this address' }),
    );
    const question = await screen.findByRole('heading', {
      name: 'Remove this address?',
    });
    await waitFor(() => expect(question).toHaveFocus());
    expect(
      screen.getByText(
        'The address for Asha Verma, 12 MG Road, will be removed.',
      ),
    ).toBeInTheDocument();
    // The default, with another address left to take its place.
    expect(
      screen.getByText('Your newest other address becomes the default.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    expect(screen.getByRole('link', { name: 'Keep it' })).toHaveAttribute(
      'href',
      `/account/addresses/${HOME.id}`,
    );

    await user.click(screen.getByRole('button', { name: 'Remove address' }));
    await waitFor(() => expect(sentForms).toHaveLength(2));
    expect(Object.fromEntries(sentForms[1] as FormData)).toEqual({
      intent: 'removeConfirmed',
    });
  });

  it('says nothing of a new default when it is the only address', async () => {
    const { user } = openEdit(HOME, 0);
    await user.click(
      await screen.findByRole('button', { name: 'Remove this address' }),
    );
    await screen.findByRole('heading', { name: 'Remove this address?' });
    expect(
      screen.queryByText('Your newest other address becomes the default.'),
    ).toBeNull();
  });
});
