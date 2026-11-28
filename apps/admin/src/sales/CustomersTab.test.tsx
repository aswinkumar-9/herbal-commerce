import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSignedIn } from '../test/console';
import { RAVI, json } from '../test/fake-api';
import { LAST_30, SALES, reportOf, salesOf } from '../test/sales-fixtures';
import type { CustomerCounts, CustomersReport } from './sales-api';
import { customerPoints } from './CustomersTab';

// 12:15 on 25 Nov 2026 in India.
const NOW = new Date('2026-11-25T06:45:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

const CUSTOMERS = (from: string, to: string, filter = '') =>
  `GET /v1/staff/reports/customers?from=${from}&to=${to}${filter}`;

const counts = (
  customers: number,
  newCustomers: number,
  boughtAgain: number,
  accountsMade: number,
): CustomerCounts => ({
  customers,
  newCustomers,
  returningCustomers: customers - newCustomers,
  boughtAgain,
  accountsMade,
});
const NONE = counts(0, 0, 0, 0);

function customersOf(
  from: string,
  to: string,
  changes: Partial<CustomersReport> = {},
): CustomersReport {
  return {
    period: { from, to },
    previousPeriod: reportOf(from, to).previousPeriod,
    refreshedAt: '2026-11-25T06:40:00.000Z',
    totals: counts(8, 3, 2, 5),
    previousTotals: counts(6, 3, 1, 5),
    series: {
      unit: 'day',
      points: [
        { start: from, ...counts(2, 1, 0, 3), previous: counts(1, 1, 0, 1) },
        { start: to, ...counts(6, 2, 2, 2), previous: counts(5, 2, 1, 4) },
      ],
    },
    topCustomers: [
      {
        userId: 'u1',
        name: 'Asha Rao',
        email: 'asha@example.com',
        orders: 3,
        salesRupees: 2450,
      },
      {
        userId: 'u2',
        name: 'Meena Iyer',
        email: 'meena@example.com',
        orders: 1,
        salesRupees: -428,
      },
    ],
    ...changes,
  };
}

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

function openCustomers(path = '/sales/customers', answers: Answers = {}) {
  return openSignedIn(path, {
    staff: RAVI,
    answers: {
      [LAST_30]: salesOf('2026-10-27', '2026-11-25'),
      [CUSTOMERS('2026-10-27', '2026-11-25')]: () =>
        json(200, customersOf('2026-10-27', '2026-11-25')),
      ...answers,
    },
  });
}

const figure = async (name: string) =>
  (await screen.findByRole('heading', { name, level: 2 }))
    .parentElement as HTMLElement;

describe('the customers tab', () => {
  it('shows the period’s customers, each beside the period before', async () => {
    openCustomers();

    expect(await figure('Customers')).toHaveTextContent('8Up 33% from 6');
    const tabs = screen.getByRole('navigation', { name: 'Sales' });
    expect(
      within(tabs).getByRole('link', { name: 'Customers' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await figure('New customers')).toHaveTextContent(
      '3Same as before, 3',
    );
    expect(await figure('Returning customers')).toHaveTextContent(
      '5Up 67% from 3',
    );
    const again = await figure('Bought more than once');
    expect(again).toHaveTextContent('2Up 100% from 1');
    expect(again).toHaveTextContent(
      '25% of the customers paid for more than one order in the period.',
    );
    expect(await figure('Accounts made')).toHaveTextContent(
      'Customers’ accounts made in the period, whether they paid or not.',
    );
    // The sales tab's tiles are not here.
    expect(screen.queryByRole('heading', { name: 'Refunds' })).toBeNull();
    expect(document.title).toContain('Customers');
  });

  it('follows one of them over time, beside the period before', async () => {
    const { user } = openCustomers();

    expect(
      await screen.findByRole('heading', {
        name: 'Customers each day',
        level: 2,
      }),
    ).toBeInTheDocument();
    const show = screen.getByRole('group', { name: 'Show' });
    expect(within(show).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('slider', { name: 'Customers each day' }),
    ).toHaveAttribute('aria-valuetext', '25 Nov 2026: 6. 26 Oct 2026: 5');

    await user.click(within(show).getByRole('button', { name: 'Accounts' }));
    expect(
      screen.getByRole('slider', { name: 'Accounts made each day' }),
    ).toHaveAttribute('aria-valuetext', '25 Nov 2026: 2. 26 Oct 2026: 4');
    // Counts on the axis, not rupees.
    expect(screen.queryByText(/₹/, { selector: 'svg text' })).toBeNull();
  });

  it('draws the bars asked for', async () => {
    const { user, router } = openCustomers('/sales/customers', {
      [SALES('2026-10-27', '2026-11-25', '&unit=week')]: salesOf(
        '2026-10-27',
        '2026-11-25',
      ),
      [CUSTOMERS('2026-10-27', '2026-11-25', '&unit=week')]: () =>
        json(
          200,
          customersOf('2026-10-27', '2026-11-25', {
            series: { unit: 'week', points: [] },
          }),
        ),
    });

    await figure('Customers');
    await user.click(
      within(screen.getByRole('group', { name: 'Bars' })).getByRole('button', {
        name: 'Weeks',
      }),
    );
    expect(router.state.location.search).toBe('?unit=week');
    expect(
      await screen.findByRole('heading', {
        name: 'Customers each week',
        level: 2,
      }),
    ).toBeInTheDocument();
  });

  it('keeps the period in every tab’s link, and turns off bars a long period has too many of', async () => {
    const days = '?from=2016-11-26&to=2026-11-25';
    openCustomers(`/sales/customers${days}`, {
      [SALES('2016-11-26', '2026-11-25')]: salesOf('2016-11-26', '2026-11-25'),
      [CUSTOMERS('2016-11-26', '2026-11-25')]: () =>
        json(
          200,
          customersOf('2016-11-26', '2026-11-25', {
            series: { unit: 'month', points: [] },
          }),
        ),
    });

    await figure('Customers');
    const tabs = screen.getByRole('navigation', { name: 'Sales' });
    for (const [name, path] of [
      ['Overview', '/sales'],
      ['Places and catalog', '/sales/places'],
      ['Customers', '/sales/customers'],
    ] as const) {
      expect(within(tabs).getByRole('link', { name })).toHaveAttribute(
        'href',
        `${path}${days}`,
      );
    }
    const bars = screen.getByRole('group', { name: 'Bars' });
    expect(within(bars).getByRole('button', { name: 'Days' })).toBeDisabled();
    // Ten years of weeks is 522 bars: too many as well.
    expect(within(bars).getByRole('button', { name: 'Weeks' })).toBeDisabled();
    expect(within(bars).getByRole('button', { name: 'Months' })).toBeEnabled();
  });

  it('shows the accounts made when no one paid', async () => {
    openCustomers('/sales/customers', {
      [CUSTOMERS('2026-10-27', '2026-11-25')]: () =>
        json(
          200,
          customersOf('2026-10-27', '2026-11-25', {
            totals: counts(0, 0, 0, 4),
            topCustomers: [],
          }),
        ),
    });

    expect(await figure('Accounts made')).toHaveTextContent('4');
    expect(
      screen.getByText('No one bought anything in this period.'),
    ).toBeInTheDocument();
  });

  it('names the best customers, on this page only', async () => {
    openCustomers();

    const table = await screen.findByRole('table', { name: 'Top customers' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Asha Raoasha@example.com3₹2,450',
      'Meena Iyermeena@example.com1−₹428',
    ]);
    expect(
      screen.getByText(/Shown here only: a download never names a customer\./),
    ).toBeInTheDocument();
  });

  it('is narrowed as the page is, but for the accounts', async () => {
    openCustomers('/sales/customers?state=Kerala', {
      [SALES('2026-10-27', '2026-11-25', '&state=Kerala')]: salesOf(
        '2026-10-27',
        '2026-11-25',
      ),
      [CUSTOMERS('2026-10-27', '2026-11-25', '&state=Kerala')]: () =>
        json(200, customersOf('2026-10-27', '2026-11-25')),
    });

    expect(await figure('Accounts made')).toHaveTextContent(
      'Never narrowed: an account has no products, state or way of paying.',
    );
  });

  it('says so when no one paid or made an account', async () => {
    openCustomers('/sales/customers', {
      [CUSTOMERS('2026-10-27', '2026-11-25')]: () =>
        json(
          200,
          customersOf('2026-10-27', '2026-11-25', {
            totals: NONE,
            topCustomers: [],
          }),
        ),
    });

    expect(
      await screen.findByText(
        /No one paid for an order or made an account in this period\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Customers' })).toBeNull();
  });

  it('says calmly when the customers cannot be loaded, and tries again', async () => {
    const { user } = openCustomers('/sales/customers', {
      [CUSTOMERS('2026-10-27', '2026-11-25')]: () =>
        json(500, { message: 'Internal server error' }),
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The customers could not be loaded');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The customers could not be loaded',
      ),
    );
  });
});

describe('the customers over time', () => {
  it('puts each bar beside the same days of the period before, for what is followed', () => {
    const report = customersOf('2026-11-01', '2026-11-14', {
      series: {
        unit: 'week',
        points: [
          {
            start: '2026-11-01',
            ...counts(2, 1, 0, 3),
            previous: counts(1, 1, 0, 1),
          },
          {
            start: '2026-11-02',
            ...counts(1, 0, 1, 0),
            previous: NONE,
          },
          {
            start: '2026-11-09',
            ...counts(5, 4, 1, 2),
            previous: counts(3, 3, 0, 1),
          },
        ],
      },
    });

    const points = customerPoints(report, 'newCustomers');
    expect(points.map((p) => [p.label, p.value, p.previous])).toEqual([
      ['1 Nov', 1, 1],
      ['2 Nov', 0, 0],
      ['9 Nov', 4, 3],
    ]);
    // Fourteen days earlier.
    expect(points[2]?.readout).toBe('9–14 Nov 2026: 4. 26–31 Oct 2026: 3');
    expect(points[2]?.cells).toEqual([
      '9–14 Nov 2026',
      '4',
      '26–31 Oct 2026',
      '3',
    ]);
    expect(customerPoints(report, 'accountsMade').map((p) => p.value)).toEqual([
      3, 0, 2,
    ]);
  });
});
