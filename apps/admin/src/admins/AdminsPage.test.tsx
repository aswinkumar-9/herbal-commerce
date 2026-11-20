import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE,
  ADMINS,
  DISABLED,
  EVERY_ADMIN,
  INVITATION_ENDED,
  INVITE,
  INVITED,
  REMOVE,
  RESEND,
  RESET,
  RESET_ENDED,
  RESET_PENDING,
  STATUS,
  adminOf,
  adminsOf,
  invitedOf,
  resetOf,
} from '../test/admin-fixtures';
import { heldBack, openSignedIn } from '../test/console';
import { RAVI, json } from '../test/fake-api';
import type { Admin } from './admins-api';

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

function openAdmins(answers: Answers = {}) {
  return openSignedIn('/admins', {
    staff: RAVI,
    answers: { [ADMINS]: adminsOf(EVERY_ADMIN), ...answers },
  });
}

const list = () => screen.findByRole('list', { name: 'Admins' });
async function rowOf(admin: Admin) {
  const rows = within(await list()).getAllByRole('listitem');
  const row = rows.find((each) => each.textContent?.includes(admin.email));
  if (!row) {
    throw new Error(`No row for ${admin.email}`);
  }
  return row;
}
const buttonsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('button')
    .map((button) => button.textContent);
const dialog = () => screen.getByRole('dialog');
const inDialog = (name: string) =>
  within(dialog()).getByRole('button', { name });
// Escape, as the browser tells a dialog of it.
const pressEscape = () =>
  act(() => {
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
  });

describe('the Admins page', () => {
  it('lists every Admin for a Super User, each saying where they stand and what comes next', async () => {
    const { api } = openAdmins();

    expect(
      await screen.findByRole('heading', { name: 'Admins', level: 1 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Admins · Herbal Commerce Admin'),
    );
    const rows = within(await list()).getAllByRole('listitem');
    expect(rows).toHaveLength(6);

    const active = await rowOf(ACTIVE);
    expect(active).toHaveTextContent('Asha VermaActive');
    expect(active).toHaveTextContent('asha@example.com');
    expect(active).toHaveTextContent('Joined 2 Nov 2026.');
    expect(buttonsOf(active)).toEqual([
      'Reset authenticator app for Asha Verma',
      'Disable for Asha Verma',
    ]);

    const resetting = await rowOf(RESET_PENDING);
    expect(resetting).toHaveTextContent('No authenticator app');
    expect(resetting).toHaveTextContent(
      'Can’t sign in until they set up their authenticator app again. Their link works until 22 Nov 2099, 15:30.',
    );
    expect(buttonsOf(resetting)).toEqual([
      'Send a new link for Meena Iyer',
      'Disable for Meena Iyer',
    ]);
    expect(await rowOf(RESET_ENDED)).toHaveTextContent(
      'Can’t sign in until they set up an authenticator app. Their link has ended: send a new one.',
    );

    const invited = await rowOf(INVITED);
    expect(invited).toHaveTextContent('Dev PatelInvited');
    expect(invited).toHaveTextContent(
      'Invited 18 Nov 2026. The link works until 22 Nov 2099, 15:30.',
    );
    expect(buttonsOf(invited)).toEqual([
      'Send the invitation again for Dev Patel',
      'Remove for Dev Patel',
    ]);
    expect(await rowOf(INVITATION_ENDED)).toHaveTextContent(
      'Invitation endedlata@example.comInvited 18 Nov 2026. The link has ended: send the invitation again.',
    );

    const disabled = await rowOf(DISABLED);
    expect(disabled).toHaveTextContent('Arjun SinghDisabled');
    expect(disabled).toHaveTextContent('Can’t sign in until enabled again.');
    expect(buttonsOf(disabled)).toEqual([
      'Enable for Arjun Singh',
      'Remove for Arjun Singh',
    ]);
    expect(api.unexpected).toEqual([]);
  });

  it('says when a disabled Admin never accepted the invitation', async () => {
    openAdmins({
      [ADMINS]: adminsOf([{ ...INVITED, status: 'DISABLED' }]),
    });

    const row = await rowOf(INVITED);
    expect(row).toHaveTextContent('Disabled');
    expect(row).toHaveTextContent(
      'Invited 18 Nov 2026. Never accepted the invitation.',
    );
  });

  it('is for Super Users only: an Admin is not shown the page, and nothing is asked', async () => {
    const { api } = openSignedIn('/admins');

    expect(
      await screen.findByRole('heading', {
        name: 'Only Super Users can open this page',
      }),
    ).toBeInTheDocument();
    expect(api.sent.some((sent) => sent.path === '/v1/staff/admins')).toBe(
      false,
    );
  });

  it('opens from the menu', async () => {
    const { user, router } = openSignedIn('/', {
      staff: RAVI,
      answers: { [ADMINS]: adminsOf(EVERY_ADMIN) },
    });
    const menu = await screen.findByRole('navigation', { name: 'Main' });

    await user.click(within(menu).getByRole('link', { name: /Admins/ }));

    await list();
    expect(router.state.location.pathname).toBe('/admins');
  });

  it('offers an invitation when there are no Admins yet', async () => {
    const { user } = openAdmins({ [ADMINS]: adminsOf([]) });

    expect(await screen.findByText('No Admins yet')).toBeInTheDocument();
    const invites = screen.getAllByRole('button', { name: 'Invite an Admin' });
    expect(invites).toHaveLength(2);
    await user.click(invites[1] as HTMLElement);
    expect(
      within(dialog()).getByRole('heading', { name: 'Invite an Admin' }),
    ).toBeInTheDocument();
  });

  it('says when the list could not be loaded, and tries again', async () => {
    const { user } = openAdmins({
      [ADMINS]: [() => json(500), adminsOf([ACTIVE])],
    });

    expect(
      await screen.findByText('The Admins could not be loaded'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The server had a problem. Try again in a moment.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await rowOf(ACTIVE)).toBeInTheDocument();
  });
});

describe('inviting an Admin', () => {
  it('checks the name and the address before sending anything', async () => {
    const { user, api } = openAdmins();
    await list();

    await user.click(screen.getByRole('button', { name: 'Invite an Admin' }));
    expect(dialog()).toHaveTextContent(
      'They get an email with a link to choose their own password and set up an authenticator app on their phone. The link works once, for 72 hours.',
    );
    expect(screen.getByLabelText('Full name')).toHaveFocus();
    await user.click(inDialog('Send the invitation'));

    expect(screen.getByLabelText('Full name')).toHaveAccessibleDescription(
      expect.stringContaining('Enter their name'),
    );
    expect(screen.getByLabelText('Email address')).toHaveAccessibleDescription(
      expect.stringContaining('Enter their email address'),
    );
    expect(screen.getByLabelText('Full name')).toHaveFocus();

    await user.type(screen.getByLabelText('Full name'), 'Dev Patel');
    await user.type(screen.getByLabelText('Email address'), 'dev at example');
    await user.click(inDialog('Send the invitation'));

    expect(screen.getByLabelText('Email address')).toHaveAccessibleDescription(
      expect.stringContaining('Enter an email address like name@example.com'),
    );
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(api.to('POST', '/v1/staff/admins')).toEqual([]);
  });

  it('sends the name and the address, says it went, and reads the list again', async () => {
    const { user, api } = openAdmins({
      [ADMINS]: [adminsOf([ACTIVE]), adminsOf([ACTIVE, INVITED])],
      [INVITE]: invitedOf(INVITED),
    });
    await rowOf(ACTIVE);

    await user.click(screen.getByRole('button', { name: 'Invite an Admin' }));
    await user.type(screen.getByLabelText('Full name'), '  Dev Patel ');
    await user.type(
      screen.getByLabelText('Email address'),
      ' Dev@Example.com ',
    );
    await user.click(inDialog('Send the invitation'));

    expect(
      await screen.findByText('Invitation sent to dev@example.com'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await rowOf(INVITED)).toHaveTextContent('Invited');
    expect(api.to('POST', '/v1/staff/admins').map((r) => r.body)).toEqual([
      { fullName: 'Dev Patel', email: 'dev@example.com' },
    ]);
  });

  it('shows an address already in use at its field', async () => {
    const { user } = openAdmins({
      [INVITE]: () =>
        json(409, {
          message: 'An account with this email address already exists.',
        }),
    });
    await list();

    await user.click(screen.getByRole('button', { name: 'Invite an Admin' }));
    await user.type(screen.getByLabelText('Full name'), 'Dev Patel');
    await user.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await user.click(inDialog('Send the invitation'));

    await waitFor(() =>
      expect(
        screen.getByLabelText('Email address'),
      ).toHaveAccessibleDescription(
        expect.stringContaining(
          'An account with this email address already exists.',
        ),
      ),
    );
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows what the API refused at each field, and anything else above them', async () => {
    const { user } = openAdmins({
      [INVITE]: [
        () =>
          json(400, {
            message: 'Validation failed',
            errors: [{ field: 'fullName', message: 'Name is required' }],
          }),
        () =>
          json(429, { message: 'Too Many Requests' }, { 'Retry-After': '600' }),
      ],
    });
    await list();
    await user.click(screen.getByRole('button', { name: 'Invite an Admin' }));
    await user.type(screen.getByLabelText('Full name'), 'Dev Patel');
    await user.type(screen.getByLabelText('Email address'), 'dev@example.com');

    await user.click(inDialog('Send the invitation'));
    await waitFor(() =>
      expect(screen.getByLabelText('Full name')).toHaveAccessibleDescription(
        expect.stringContaining('Name is required'),
      ),
    );

    await user.click(inDialog('Send the invitation'));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Too many tries. Wait 10 minutes and try again.',
    );
  });

  it('keeps saying so when the email could not be sent, until it is dismissed', async () => {
    const { user } = openAdmins({ [INVITE]: invitedOf(INVITED, false) });
    await list();

    await user.click(screen.getByRole('button', { name: 'Invite an Admin' }));
    await user.type(screen.getByLabelText('Full name'), 'Dev Patel');
    await user.type(screen.getByLabelText('Email address'), 'dev@example.com');
    await user.click(inDialog('Send the invitation'));

    const notice = await screen.findByText(
      'Dev Patel is added, but the invitation to dev@example.com could not be emailed. Send it again from their row.',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(notice.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText(/Invitation sent to/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText(/is added, but/)).toBeNull());
  });

  it('can be cancelled, sending nothing', async () => {
    const { user, api } = openAdmins();
    await list();

    await user.click(screen.getByRole('button', { name: 'Invite an Admin' }));
    await user.type(screen.getByLabelText('Full name'), 'Dev Patel');
    await user.click(inDialog('Cancel'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.to('POST', '/v1/staff/admins')).toEqual([]);
  });

  it('stays open while the invitation is on its way', async () => {
    const answer = heldBack();
    const { user, api } = openAdmins({ [INVITE]: answer.answer });
    await list();
    await user.click(screen.getByRole('button', { name: 'Invite an Admin' }));
    await user.type(screen.getByLabelText('Full name'), 'Dev Patel');
    await user.type(screen.getByLabelText('Email address'), 'dev@example.com');

    await user.click(inDialog('Send the invitation'));
    pressEscape();
    await user.click(inDialog('Sending…'));

    expect(dialog()).toBeInTheDocument();
    expect(inDialog('Cancel')).toBeDisabled();
    expect(api.to('POST', '/v1/staff/admins')).toHaveLength(1);
    await act(async () => answer.release(invitedOf(INVITED)()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the steps for one Admin', () => {
  it('sends a pending Admin the invitation again, saying the earlier link stops working', async () => {
    const { user, api } = openAdmins({ [RESEND(INVITED)]: invitedOf(INVITED) });
    const row = await rowOf(INVITED);

    await user.click(
      within(row).getByRole('button', { name: /Send the invitation again/ }),
    );
    expect(
      within(dialog()).getByRole('heading', {
        name: 'Send Dev Patel the invitation again?',
      }),
    ).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(
      'A new email goes to dev@example.com, with a link that works once, for 72 hours.',
    );
    expect(dialog()).toHaveTextContent(
      'The link in any earlier email stops working.',
    );
    await user.click(inDialog('Send it again'));

    expect(
      await screen.findByText('Invitation sent again to dev@example.com'),
    ).toBeInTheDocument();
    expect(
      api.to('POST', `/v1/staff/admins/${INVITED.id}/invitation`),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(api.to('GET', '/v1/staff/admins')).toHaveLength(2),
    );
  });

  it('says on the page when the invitation sent again could not be emailed', async () => {
    const { user } = openAdmins({
      [RESEND(INVITATION_ENDED)]: invitedOf(INVITATION_ENDED, false),
    });
    const row = await rowOf(INVITATION_ENDED);

    await user.click(
      within(row).getByRole('button', { name: /Send the invitation again/ }),
    );
    await user.click(inDialog('Send it again'));

    expect(
      await screen.findByText(
        'The invitation to lata@example.com could not be emailed. Send it again.',
      ),
    ).toBeInTheDocument();
  });

  it('resets the authenticator app of an Admin who lost their phone, saying all that follows', async () => {
    const reset: Admin = {
      ...ACTIVE,
      mfaEnabledAt: null,
      authenticatorLinkExpiresAt: RESET_PENDING.authenticatorLinkExpiresAt,
    };
    const { user, api } = openAdmins({
      [ADMINS]: [adminsOf([ACTIVE]), adminsOf([reset])],
      [RESET(ACTIVE)]: resetOf(ACTIVE),
    });
    const row = await rowOf(ACTIVE);

    await user.click(
      within(row).getByRole('button', { name: /Reset authenticator app/ }),
    );
    const box = dialog();
    expect(
      within(box).getByRole('heading', {
        name: 'Reset Asha Verma’s authenticator app?',
      }),
    ).toBeInTheDocument();
    expect(box).toHaveTextContent(
      'Only when they have lost their phone, or someone else may have it.',
    );
    expect(box).toHaveTextContent(
      'The app on that phone stops working at once, and they are signed out everywhere.',
    );
    expect(box).toHaveTextContent(
      'A new email goes to asha@example.com, with a link to set up the app again with their own password. It works once, for 72 hours.',
    );
    // The safe answer takes the focus.
    expect(within(box).getByRole('button', { name: 'Keep it' })).toHaveFocus();
    await user.click(inDialog('Reset the app'));

    expect(
      await screen.findByText(
        'Asha Verma’s authenticator app is reset. The link is on its way.',
      ),
    ).toBeInTheDocument();
    expect(await rowOf(ACTIVE)).toHaveTextContent('No authenticator app');
    expect(
      api.to('POST', `/v1/staff/admins/${ACTIVE.id}/authenticator-reset`),
    ).toHaveLength(1);
  });

  it('says on the page when the reset link could not be emailed', async () => {
    const { user } = openAdmins({
      [RESET(RESET_ENDED)]: resetOf(RESET_ENDED, false),
    });
    const row = await rowOf(RESET_ENDED);

    await user.click(
      within(row).getByRole('button', { name: /Send a new link/ }),
    );
    await user.click(inDialog('Reset the app'));

    expect(
      await screen.findByText(
        'Kiran Rao’s authenticator app is reset, but the email with the link could not be sent. Send a new link from their row.',
      ),
    ).toBeInTheDocument();
  });

  it('disables an Admin, then enables them again, the row changing at once', async () => {
    const disabled: Admin = { ...ACTIVE, status: 'DISABLED' };
    // The list is read again after each step, but that answer never comes:
    // the row changes from the step's own answer.
    const reRead = heldBack();
    const { user, api } = openAdmins({
      [ADMINS]: [adminsOf([ACTIVE]), reRead.answer],
      [STATUS(ACTIVE)]: [adminOf(disabled), adminOf(ACTIVE)],
    });
    let row = await rowOf(ACTIVE);

    await user.click(within(row).getByRole('button', { name: /^Disable/ }));
    expect(dialog()).toHaveTextContent(
      'They are signed out everywhere at once, and can’t sign in until a Super User enables them again.',
    );
    expect(dialog()).toHaveTextContent('Nothing they did is undone.');
    await user.click(inDialog('Disable'));

    expect(await screen.findByText('Asha Verma disabled')).toBeInTheDocument();
    row = await rowOf(ACTIVE);
    expect(row).toHaveTextContent('Disabled');

    await user.click(within(row).getByRole('button', { name: /^Enable/ }));
    expect(dialog()).toHaveTextContent(
      'They can sign in again with their password and authenticator app.',
    );
    await user.click(inDialog('Enable'));

    expect(await screen.findByText('Asha Verma enabled')).toBeInTheDocument();
    expect(
      api.to('PATCH', `/v1/staff/admins/${ACTIVE.id}`).map((r) => r.body),
    ).toEqual([{ status: 'DISABLED' }, { status: 'ACTIVE' }]);
  });

  it('removes a disabled Admin, saying the audit log keeps what they did', async () => {
    // The row goes at once, before the list is read again.
    const reRead = heldBack();
    const { user, api } = openAdmins({
      [ADMINS]: [adminsOf([ACTIVE, DISABLED]), reRead.answer],
      [REMOVE(DISABLED)]: () => json(204),
    });
    const row = await rowOf(DISABLED);

    await user.click(within(row).getByRole('button', { name: /^Remove/ }));
    expect(dialog()).toHaveTextContent(
      'Their account goes for good. To let them back, invite them again.',
    );
    expect(dialog()).toHaveTextContent(
      'The audit log keeps everything they did.',
    );
    await user.click(inDialog('Remove Arjun Singh'));

    expect(await screen.findByText('Arjun Singh removed')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('arjun@example.com')).toBeNull(),
    );
    // The button that opened it is gone: the page's main area takes the
    // focus, so it is not lost.
    await waitFor(() => expect(document.getElementById('main')).toHaveFocus());
    expect(api.to('DELETE', `/v1/staff/admins/${DISABLED.id}`)).toHaveLength(1);
  });

  it('says why when someone else got there first, and reads the list again', async () => {
    const { user, api } = openAdmins({
      [REMOVE(INVITED)]: () =>
        json(409, { message: 'Disable this Admin before removing them.' }),
    });
    const row = await rowOf(INVITED);

    await user.click(within(row).getByRole('button', { name: /^Remove/ }));
    expect(dialog()).toHaveTextContent(
      'Their invitation link stops working, and the account goes for good.',
    );
    await user.click(inDialog('Remove Dev Patel'));

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Disable this Admin before removing them.',
    );
    await waitFor(() =>
      expect(api.to('GET', '/v1/staff/admins')).toHaveLength(2),
    );
  });

  it('stays open while the step is on its way, and can be left once it is answered', async () => {
    const answer = heldBack();
    const { user, api } = openAdmins({ [STATUS(ACTIVE)]: answer.answer });
    const row = await rowOf(ACTIVE);

    await user.click(within(row).getByRole('button', { name: /^Disable/ }));
    await user.click(inDialog('Disable'));
    pressEscape();
    await user.click(inDialog('Disabling…'));

    expect(dialog()).toBeInTheDocument();
    expect(inDialog('Keep them active')).toBeDisabled();
    expect(api.to('PATCH', `/v1/staff/admins/${ACTIVE.id}`)).toHaveLength(1);
    await act(async () => answer.release(json(500)));

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'The server had a problem. Try again in a moment.',
    );
    await user.click(inDialog('Keep them active'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('starts each step afresh, with nothing said in the last one', async () => {
    const { user } = openAdmins({
      [STATUS(ACTIVE)]: () => json(500),
    });
    const row = await rowOf(ACTIVE);

    await user.click(within(row).getByRole('button', { name: /^Disable/ }));
    await user.click(inDialog('Disable'));
    await within(dialog()).findByRole('alert');
    await user.click(inDialog('Keep them active'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(
      within(row).getByRole('button', { name: /Reset authenticator app/ }),
    );
    expect(within(dialog()).queryByRole('alert')).toBeNull();
  });
});
