import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ADMINS, ACTIVE, adminsOf } from '../test/admin-fixtures';
import {
  ASHA_PERSON,
  AUDIT,
  ORDER_ID,
  RAVI_PERSON,
  auditOf,
  entryOf,
} from '../test/audit-fixtures';
import { openSignedIn } from '../test/console';
import { RAVI, json } from '../test/fake-api';

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

const PACKED = entryOf({ action: 'order.packed' });
const SIGNED_IN = entryOf({
  action: 'staff.signed_in',
  targetType: 'session',
  targetId: 'session-1',
  before: null,
  after: null,
  subject: null,
  createdAt: '2026-11-19T04:00:00.000Z',
});
const YESTERDAY = entryOf({
  action: 'admin.disabled',
  actorId: RAVI_PERSON.id,
  actor: RAVI_PERSON,
  targetType: 'user',
  targetId: ASHA_PERSON.id,
  target: ASHA_PERSON,
  subject: null,
  before: { status: 'ACTIVE' },
  after: { status: 'DISABLED' },
  createdAt: '2026-11-18T12:00:00.000Z',
});

function openLog(path = '/audit-log', answers: Answers = {}) {
  return openSignedIn(path, {
    staff: RAVI,
    answers: {
      [ADMINS]: adminsOf([ACTIVE]),
      [AUDIT()]: auditOf([PACKED, SIGNED_IN, YESTERDAY]),
      ...answers,
    },
  });
}

// A whole sentence, though its parts are elements of their own.
const sentence = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text;

const dayList = (day: string) =>
  screen.findByRole('list', { name: `Entries on ${day}` });

describe('the audit log', () => {
  it('tells each entry in a sentence, under its day in India, newest first', async () => {
    const { api } = openLog();

    expect(
      await screen.findByRole('heading', { name: 'Audit log', level: 1 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Audit log · Herbal Commerce Admin'),
    );
    const today = within(await dayList('19 Nov 2026')).getAllByRole('listitem');
    expect(today.map((row) => row.querySelector('p')?.textContent)).toEqual([
      'Asha Verma packed order 7KQ2M9XDPA',
      'Asha Verma signed in',
    ]);
    expect(today[0]).toHaveTextContent('15:35');
    expect(
      within(await dayList('18 Nov 2026')).getByText(/disabled/),
    ).toHaveTextContent('Ravi Kumar disabled Asha Verma');
    expect(
      within(today[0] as HTMLElement).getByRole('link', { name: '7KQ2M9XDPA' }),
    ).toHaveAttribute('href', `/orders/${ORDER_ID}`);
    expect(api.unexpected).toEqual([]);
  });

  it('shows what changed on request, with where it came from', async () => {
    const { user } = openLog();
    const [row] = within(await dayList('19 Nov 2026')).getAllByRole('listitem');
    const box = row as HTMLElement;

    await user.click(
      within(box).getByText('What changed', { selector: 'summary' }),
    );

    const table = within(box).getByRole('table', { name: 'What changed' });
    expect(
      within(table)
        .getAllByRole('row')
        .map((tr) => tr.textContent),
    ).toEqual(['FieldBeforeAfter', 'StatusTo packPacked']);
    expect(box).toHaveTextContent('From 203.0.113.7. Request req-1.');
  });

  it('shows only where it came from when nothing changed', async () => {
    const { user } = openLog();
    const rows = within(await dayList('19 Nov 2026')).getAllByRole('listitem');
    const signIn = rows[1] as HTMLElement;

    await user.click(within(signIn).getByText('Details'));

    expect(within(signIn).queryByRole('table')).toBeNull();
    expect(signIn).toHaveTextContent('From 203.0.113.7.');
  });

  it('narrows to one kind of change, keeping it in the address', async () => {
    const { user, router, api } = openLog('/audit-log', {
      [AUDIT('?kind=orders')]: auditOf([PACKED]),
    });
    await dayList('19 Nov 2026');

    await user.click(
      screen.getByRole('button', { name: 'Orders and refunds' }),
    );

    await waitFor(() =>
      expect(router.state.location.search).toBe('?kind=orders'),
    );
    expect(
      screen.getByRole('button', { name: 'Orders and refunds' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(screen.queryByText(sentence('Asha Verma signed in'))).toBeNull(),
    );
    expect(api.to('GET', '/v1/staff/audit-log?kind=orders')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Everything' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('narrows to one person: the Super User reading it, or an Admin', async () => {
    const { user, router } = openLog('/audit-log', {
      [AUDIT(`?actorId=${ACTIVE.id}`)]: auditOf([PACKED]),
    });
    await dayList('19 Nov 2026');
    const person = screen.getByLabelText('Done by');

    expect(
      within(person)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Everyone', 'You (Ravi Kumar)', 'Asha Verma']);
    await user.selectOptions(person, 'Asha Verma');

    await waitFor(() =>
      expect(router.state.location.search).toBe(`?actor=${ACTIVE.id}`),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(sentence('Ravi Kumar disabled Asha Verma')),
      ).toBeNull(),
    );
  });

  it('opens on an Admin from their row: What they did', async () => {
    const { user, router } = openSignedIn('/admins', {
      staff: RAVI,
      answers: {
        [ADMINS]: adminsOf([ACTIVE]),
        [AUDIT(`?actorId=${ACTIVE.id}`)]: auditOf([PACKED]),
      },
    });
    const row = within(
      await screen.findByRole('list', { name: 'Admins' }),
    ).getByRole('listitem');

    await user.click(within(row).getByRole('link', { name: /What they did/ }));

    expect(
      await screen.findByRole('heading', { name: 'Audit log', level: 1 }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?actor=${ACTIVE.id}`);
    expect(screen.getByLabelText('Done by')).toHaveValue(ACTIVE.id);
    expect(
      await screen.findByText(sentence('Asha Verma packed order 7KQ2M9XDPA')),
    ).toBeInTheDocument();
  });

  it('names someone who is neither the reader nor an Admin, from the entries', async () => {
    const other = {
      ...RAVI_PERSON,
      id: '6a000000-0000-4000-8000-0000000000ff',
      fullName: 'Meera Super',
    };
    openLog(`/audit-log?actor=${other.id}`, {
      [AUDIT(`?actorId=${other.id}`)]: auditOf([
        entryOf({ actorId: other.id, actor: other }),
      ]),
    });

    await screen.findByText(sentence('Meera Super packed order 7KQ2M9XDPA'));
    expect(screen.getByLabelText('Done by')).toHaveDisplayValue('Meera Super');
  });

  it('shows one thing only, named by the link that led here, until asked for everything', async () => {
    const { user, router } = openLog(
      {
        pathname: '/audit-log',
        search: `?target=${ORDER_ID}`,
        state: { label: 'order 7KQ2M9XDPA' },
      } as never,
      {
        [AUDIT(`?targetId=${ORDER_ID}`)]: auditOf([PACKED]),
        [AUDIT(`?kind=orders&targetId=${ORDER_ID}`)]: auditOf([]),
      },
    );

    expect(
      await screen.findByText('Only order 7KQ2M9XDPA'),
    ).toBeInTheDocument();
    // Another filter keeps the name, though nothing is listed to take it from.
    await user.click(
      screen.getByRole('button', { name: 'Orders and refunds' }),
    );
    await screen.findByText('Nothing matches');
    expect(screen.getByText('Only order 7KQ2M9XDPA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Everything' }));
    await dayList('19 Nov 2026');
    await user.click(screen.getByRole('button', { name: 'Show everything' }));

    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.queryByText(/^Only /)).toBeNull();
  });

  it('ignores filters that are not real, and asks for everything', async () => {
    const { api } = openLog('/audit-log?kind=payments&actor=nobody&target=x');

    await dayList('19 Nov 2026');
    expect(api.to('GET', '/v1/staff/audit-log')).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  });

  it('shows older entries a page at a time', async () => {
    const older = entryOf({ createdAt: '2026-11-01T06:00:00.000Z' });
    const { user } = openLog('/audit-log', {
      [AUDIT()]: auditOf([PACKED], PACKED.id),
      [AUDIT(`?before=${PACKED.id}`)]: auditOf([older]),
    });
    await dayList('19 Nov 2026');

    await user.click(
      screen.getByRole('button', { name: 'Show older entries' }),
    );

    expect(await dayList('1 Nov 2026')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show older entries' }),
    ).toBeNull();
  });

  it('shows the reports downloaded, a kind of its own', async () => {
    const DOWNLOADED = entryOf({
      action: 'report.sales_exported',
      actorId: RAVI_PERSON.id,
      actor: RAVI_PERSON,
      targetType: 'report',
      targetId: null,
      subject: null,
      before: null,
      after: { from: '2026-11-01', to: '2026-11-19', registerLines: 40 },
    });
    const { user, router } = openLog('/audit-log', {
      [AUDIT('?kind=reports')]: auditOf([DOWNLOADED]),
    });
    await dayList('19 Nov 2026');

    await user.click(
      screen.getByRole('button', { name: 'Reports downloaded' }),
    );
    await waitFor(() =>
      expect(router.state.location.search).toBe('?kind=reports'),
    );
    expect(
      await screen.findByText(
        sentence('Ravi Kumar downloaded the sales report of 1–19 Nov 2026'),
      ),
    ).toBeInTheDocument();
  });

  it('says when nothing matches, and clears the filters', async () => {
    const { user, router } = openLog('/audit-log?kind=stock', {
      [AUDIT('?kind=stock')]: auditOf([]),
    });

    expect(await screen.findByText('Nothing matches')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show everything' }));

    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await dayList('19 Nov 2026')).toBeInTheDocument();
  });

  it('says when it could not be loaded, and tries again', async () => {
    const { user } = openLog('/audit-log', {
      [AUDIT()]: [() => json(500), auditOf([PACKED])],
    });

    expect(
      await screen.findByText('The audit log could not be loaded'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await dayList('19 Nov 2026')).toBeInTheDocument();
  });

  it('is for Super Users only', async () => {
    const { api } = openSignedIn('/audit-log');

    expect(
      await screen.findByRole('heading', {
        name: 'Only Super Users can open this page',
      }),
    ).toBeInTheDocument();
    expect(
      api.sent.some((sent) => sent.path.startsWith('/v1/staff/audit-log')),
    ).toBe(false);
  });
});
