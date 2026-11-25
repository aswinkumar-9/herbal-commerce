import {
  renderHook,
  act,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heldBack, openSignedIn } from '../test/console';
import { ASHA, RAVI, json, offline } from '../test/fake-api';
import {
  LAST_30,
  NOTHING,
  SALES,
  SOME,
  reportOf,
  salesOf,
} from '../test/sales-fixtures';
import { useIndiaToday } from './use-india-today';

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

// 12:15 on 25 Nov 2026 in India.
const NOW = new Date('2026-11-25T06:45:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

function openSales(path = '/sales', answers: Answers = {}) {
  return openSignedIn(path, {
    staff: RAVI,
    answers: {
      [LAST_30]: salesOf('2026-10-27', '2026-11-25', {
        previousTotals: {
          ...SOME,
          salesRupees: 1000,
          orders: 4,
          averageOrderRupees: 400,
          refundedRupees: 0,
          refundedOrders: 0,
          newCustomers: 1,
          returningCustomers: 1,
        },
      }),
      ...answers,
    },
  });
}

// A figure is found by its name, a heading.
const figure = async (name: string) =>
  (await screen.findByRole('heading', { name, level: 2 }))
    .parentElement as HTMLElement;
// Which way a figure's change points, by its icon: the words say it too.
const trend = (figure: HTMLElement) => {
  const icon = figure.querySelector('svg.lucide');
  return icon === null
    ? null
    : (['trending-up', 'trending-down', 'minus'].find((name) =>
        icon.classList.contains(`lucide-${name}`),
      ) ?? 'other');
};
const chip = (name: string) => screen.getByRole('button', { name });
const sentence = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text;

describe('the Sales page', () => {
  it('is in the menu for Super Users, and opens on the last 30 days beside the 30 before', async () => {
    const { api, user } = openSales('/');

    const menu = await screen.findByRole('navigation', { name: 'Main' });
    await screen.findByRole('heading', { name: 'Welcome, Ravi' });
    await user.click(within(menu).getByRole('link', { name: 'Sales' }));

    expect(
      await screen.findByRole('heading', { name: 'Sales', level: 1 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Sales · Herbal Commerce Admin'),
    );
    expect(within(menu).getByRole('link', { name: 'Sales' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(chip('Last 30 days')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Today')).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText(
        sentence('27 Oct – 25 Nov 2026, compared with 27 Sep – 26 Oct 2026'),
      ),
    ).toBeInTheDocument();

    const sales = await figure('Sales');
    expect(sales).toHaveTextContent('₹1,374');
    expect(sales).toHaveTextContent('Up 37% from ₹1,000');
    expect(trend(sales)).toBe('trending-up');
    expect(sales).toHaveTextContent(
      'What the products sold for, without GST, less refunds.',
    );
    expect(screen.getByText('GST').nextSibling).toHaveTextContent('₹179');
    expect(screen.getByText('Delivery').nextSibling).toHaveTextContent('₹49');
    expect(screen.getByText('Paid in all').nextSibling).toHaveTextContent(
      '₹1,602',
    );

    const orders = await figure('Orders');
    expect(orders).toHaveTextContent('4Same as before, 4');
    expect(trend(orders)).toBe('minus');
    expect(await figure('Average order')).toHaveTextContent(
      '₹451Up 13% from ₹400',
    );
    const refunds = await figure('Refunds');
    expect(refunds).toHaveTextContent('₹498Up ₹498 from ₹0');
    expect(refunds).toHaveTextContent('1 order refunded in the period');
    expect(await figure('New customers')).toHaveTextContent('2Up 100% from 1');
    expect(await figure('Returning customers')).toHaveTextContent(
      '1Same as before, 1',
    );

    expect(
      screen.getByText(
        'Updated today at 12:10. New payments show within 5 minutes.',
      ),
    ).toBeInTheDocument();
    expect(api.to('GET', LAST_30.slice(4))).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  });

  it('shows a preset a click away, keeping the last figures, dimmed, until it comes', async () => {
    const thisYear = heldBack();
    const { router, user, api } = openSales('/sales', {
      [SALES('2026-01-01', '2026-11-25')]: thisYear.answer,
    });
    await figure('Sales');

    await user.click(chip('This year'));
    expect(router.state.location.search).toBe('?period=this-year');
    expect(chip('This year')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Last 30 days')).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText(
        sentence('1 Jan – 25 Nov 2026, compared with 6 Feb – 31 Dec 2025'),
      ),
    ).toBeInTheDocument();
    // The last 30 days stay, dimmed and marked busy.
    const sales = await figure('Sales');
    expect(sales).toHaveTextContent('₹1,374');
    expect(sales.closest('[aria-busy="true"]')).toHaveClass('opacity-60');

    thisYear.release(
      json(
        200,
        reportOf('2026-01-01', '2026-11-25', {
          totals: { ...SOME, salesRupees: 125_000 },
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Sales', level: 2 }).parentElement,
      ).toHaveTextContent('₹1,25,000'),
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();

    // The default needs nothing in the address.
    await user.click(chip('Last 30 days'));
    expect(router.state.location.search).toBe('');
    expect(api.unexpected).toEqual([]);
  });

  it('opens on the period the address names', async () => {
    const { api } = openSales('/sales?period=yesterday', {
      [SALES('2026-11-24', '2026-11-24')]: salesOf('2026-11-24', '2026-11-24'),
    });

    expect(await figure('Sales')).toHaveTextContent('₹1,374');
    expect(chip('Yesterday')).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(sentence('24 Nov 2026, compared with 23 Nov 2026')),
    ).toBeInTheDocument();
    expect(api.unexpected).toEqual([]);
  });

  it('shows any two days, checked before they are asked for', async () => {
    const { router, user, api } = openSales('/sales', {
      [SALES('2026-11-01', '2026-11-10')]: salesOf('2026-11-01', '2026-11-10'),
    });
    await figure('Sales');

    await user.click(chip('Choose days'));
    expect(chip('Choose days')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Last 30 days')).toHaveAttribute('aria-pressed', 'false');
    const form = screen.getByRole('form', { name: 'Choose the days' });
    expect(chip('Choose days')).toHaveAttribute('aria-controls', form.id);
    const first = within(form).getByLabelText('First day');
    const last = within(form).getByLabelText('Last day');
    // It starts from the period shown, and offers no day after today.
    expect(first).toHaveValue('2026-10-27');
    expect(last).toHaveValue('2026-11-25');
    expect(last).toHaveAttribute('max', '2026-11-25');

    await user.clear(first);
    await user.click(
      within(form).getByRole('button', { name: 'Show these days' }),
    );
    expect(
      await within(form).findByText('Choose the first day'),
    ).toBeInTheDocument();
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-invalid', 'true');

    await user.type(first, '2026-11-26');
    expect(first).not.toHaveAttribute('aria-invalid');
    await user.click(
      within(form).getByRole('button', { name: 'Show these days' }),
    );
    expect(
      await within(form).findByText('Choose a day on or after the first day'),
    ).toBeInTheDocument();
    expect(last).toHaveFocus();
    expect(router.state.location.search).toBe('');

    await user.clear(first);
    await user.type(first, '2026-11-01');
    await user.clear(last);
    await user.type(last, '2026-11-10');
    await user.click(
      within(form).getByRole('button', { name: 'Show these days' }),
    );

    expect(router.state.location.search).toBe('?from=2026-11-01&to=2026-11-10');
    expect(
      await screen.findByText(
        sentence('1–10 Nov 2026, compared with 22–31 Oct 2026'),
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        api.to('GET', SALES('2026-11-01', '2026-11-10').slice(4)),
      ).toHaveLength(1),
    );
    // The days stay open to change, and a preset closes them.
    expect(screen.getByLabelText('First day')).toHaveValue('2026-11-01');
    await user.click(chip('Today'));
    expect(
      screen.queryByRole('form', { name: 'Choose the days' }),
    ).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?period=today');
  });

  it('closes the days again when a preset is chosen instead', async () => {
    const { router, user } = openSales('/sales', {
      [SALES('2026-11-19', '2026-11-25')]: salesOf('2026-11-19', '2026-11-25'),
    });
    await figure('Sales');

    await user.click(chip('Choose days'));
    expect(
      screen.getByRole('form', { name: 'Choose the days' }),
    ).toBeInTheDocument();
    await user.click(chip('Last 7 days'));
    expect(
      screen.queryByRole('form', { name: 'Choose the days' }),
    ).not.toBeInTheDocument();
    expect(chip('Last 7 days')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Choose days')).toHaveAttribute('aria-pressed', 'false');
    expect(router.state.location.search).toBe('?period=last-7-days');
  });

  it('opens two days from the address with them chosen, and follows it', async () => {
    const { router } = openSales('/sales?from=2026-11-01&to=2026-11-10', {
      [SALES('2026-11-01', '2026-11-10')]: salesOf('2026-11-01', '2026-11-10'),
      [SALES('2026-11-05', '2026-11-06')]: salesOf('2026-11-05', '2026-11-06'),
    });

    await figure('Sales');
    expect(chip('Choose days')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('First day')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('Last day')).toHaveValue('2026-11-10');

    // Back and forward, say, to other days.
    await act(() => router.navigate('/sales?from=2026-11-05&to=2026-11-06'));
    expect(screen.getByLabelText('First day')).toHaveValue('2026-11-05');
    expect(screen.getByLabelText('Last day')).toHaveValue('2026-11-06');
  });

  it('says so when nothing was paid or refunded, and when more went back than was sold', async () => {
    const { user } = openSales('/sales?period=today', {
      [SALES('2026-11-25', '2026-11-25')]: salesOf('2026-11-25', '2026-11-25', {
        totals: NOTHING,
        previousTotals: NOTHING,
      }),
      [SALES('2026-11-24', '2026-11-24')]: salesOf('2026-11-24', '2026-11-24', {
        totals: {
          ...NOTHING,
          salesRupees: -428,
          gstRupees: -51,
          paidRupees: -479,
          refundedOrders: 1,
          refundedRupees: 479,
        },
        previousTotals: SOME,
      }),
    });

    expect(await figure('Sales')).toHaveTextContent('₹0Same as before, ₹0');
    const average = await figure('Average order');
    expect(average).toHaveTextContent('No ordersNo orders before either');
    // Nothing to point up or down from.
    expect(trend(average)).toBeNull();
    expect(
      screen.getByText(/Nothing was paid for or refunded in this period/),
    ).toBeInTheDocument();
    // No chart or lists of nothing.
    expect(
      screen.queryByRole('heading', { name: 'Sales each day' }),
    ).not.toBeInTheDocument();

    await user.click(chip('Yesterday'));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Sales', level: 2 }).parentElement,
      ).toHaveTextContent('−₹428Down ₹1,802 from ₹1,374'),
    );
    expect(trend(await figure('Sales'))).toBe('trending-down');
    expect(screen.getByText('Paid in all').nextSibling).toHaveTextContent(
      '−₹479',
    );
    expect(await figure('Average order')).toHaveTextContent(
      'No orders₹451 before',
    );
    expect(
      screen.queryByText(/Nothing was paid for or refunded/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Sales each day' }),
    ).toBeInTheDocument();
  });

  it('says when the figures have never been worked out', async () => {
    openSales('/sales', {
      [LAST_30]: salesOf('2026-10-27', '2026-11-25', { refreshedAt: null }),
    });

    expect(
      await screen.findByText(
        'The figures are being worked out for the first time. Look again in a minute.',
      ),
    ).toBeInTheDocument();
  });

  it('shows a calm message when the sales cannot be loaded, and tries again', async () => {
    const { user } = openSales('/sales', {
      [LAST_30]: [offline, salesOf('2026-10-27', '2026-11-25')],
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The sales could not be loaded');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await figure('Sales')).toHaveTextContent('₹1,374');
  });

  it('is kept from Admins, in the menu and at its address', async () => {
    openSignedIn('/sales', { staff: ASHA });

    expect(
      await screen.findByRole('heading', {
        name: 'Only Super Users can open this page',
      }),
    ).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(menu).queryByRole('link', { name: 'Sales' }),
    ).not.toBeInTheDocument();
  });
});

describe('today in India', () => {
  it('moves on to the next day at midnight there', () => {
    vi.useFakeTimers({ now: new Date('2026-11-25T18:29:00.000Z') });
    const { result } = renderHook(() => useIndiaToday());
    expect(result.current).toBe('2026-11-25');

    act(() => vi.advanceTimersByTime(59_000));
    expect(result.current).toBe('2026-11-25');
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current).toBe('2026-11-26');
  });
});
