import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSignedIn } from '../test/console';
import { RAVI, json } from '../test/fake-api';
import { LAST_30, SALES, reportOf, salesOf } from '../test/sales-fixtures';
import type { OrderCounts, OrdersReport } from './sales-api';
import { orderPoints, partsOf, waitedName } from './OrdersTab';

// 12:20 on 25 Nov 2026 in India, 5 minutes after the orders were read.
const NOW = new Date('2026-11-25T06:50:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

const ORDERS = (from: string, to: string, filter = '') =>
  `GET /v1/staff/reports/orders?from=${from}&to=${to}${filter}`;

const counts = (some: Partial<OrderCounts>): OrderCounts => ({
  placed: 0,
  paid: 0,
  waitingForPayment: 0,
  toPack: 0,
  toShip: 0,
  onTheWay: 0,
  delivered: 0,
  expired: 0,
  cancelled: 0,
  customerCancelledUnpaid: 0,
  customerCancelledPaid: 0,
  staffCancelledUnpaid: 0,
  staffCancelledPaid: 0,
  ...some,
});

const NOVEMBER = counts({
  placed: 9,
  paid: 6,
  waitingForPayment: 1,
  toPack: 2,
  toShip: 1,
  onTheWay: 1,
  delivered: 1,
  expired: 1,
  cancelled: 2,
  customerCancelledUnpaid: 1,
  staffCancelledPaid: 1,
});
const OCTOBER = counts({
  placed: 6,
  paid: 4,
  delivered: 3,
  expired: 2,
  cancelled: 1,
  customerCancelledPaid: 1,
});

const refund = (status: string, refunds = 0, rupees = 0) => ({
  status,
  refunds,
  rupees,
});
const why = (reason: string, refunds = 0, rupees = 0) => ({
  reason,
  refunds,
  rupees,
});

function ordersOf(
  from: string,
  to: string,
  changes: Partial<OrdersReport> = {},
): OrdersReport {
  return {
    period: { from, to },
    previousPeriod: reportOf(from, to).previousPeriod,
    readAt: '2026-11-25T06:45:00.000Z',
    waiting: {
      payment: { orders: 2, since: '2026-11-25T03:45:00.000Z' },
      toPack: { orders: 11, since: '2026-11-20T04:00:00.000Z' },
      toShip: { orders: 1, since: '2026-11-25T06:05:00.000Z' },
      onTheWay: { orders: 0, since: null },
      refunds: {
        refunds: 3,
        rupees: 1494,
        since: '2026-11-24T05:45:00.000Z',
      },
      failedRefunds: {
        refunds: 1,
        rupees: 498,
        since: '2026-11-20T15:00:00.000Z',
      },
    },
    totals: NOVEMBER,
    previousTotals: OCTOBER,
    series: {
      unit: 'day',
      points: [
        {
          start: from,
          ...counts({ placed: 4, delivered: 1 }),
          previous: counts({ placed: 2, delivered: 2 }),
        },
        {
          start: to,
          ...counts({ placed: 5, delivered: 0 }),
          previous: counts({ placed: 4, delivered: 1 }),
        },
      ],
    },
    refunds: {
      byStatus: [
        refund('PROCESSED', 2, 945),
        refund('PENDING'),
        refund('REQUESTED', 1, 498),
        refund('FAILED'),
        refund('GIVEN_BACK', 1, 498),
      ],
      byReason: [
        why('CANCELLED_BY_CUSTOMER', 1, 498),
        why('CANCELLED_BY_STAFF', 1, 498),
        why('ORDER_EXPIRED'),
        why('ORDER_CANCELLED', 1, 498),
        why('ALREADY_PAID', 1, 447),
      ],
    } as OrdersReport['refunds'],
    ...changes,
  };
}

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

function openOrders(path = '/sales/orders', answers: Answers = {}) {
  return openSignedIn(path, {
    staff: RAVI,
    answers: {
      [LAST_30]: salesOf('2026-10-27', '2026-11-25'),
      [ORDERS('2026-10-27', '2026-11-25')]: () =>
        json(200, ordersOf('2026-10-27', '2026-11-25')),
      ...answers,
    },
  });
}

const tile = async (name: string, level = 3) =>
  (await screen.findByRole('heading', { name, level }))
    .parentElement as HTMLElement;

describe('the orders tab', () => {
  it('tells what waits now at each step, since when, each a way to its list', async () => {
    openOrders();

    const toPack = await tile('To pack');
    expect(toPack).toHaveTextContent('11The oldest was paid for 5 days ago.');
    expect(
      within(toPack).getByRole('link', { name: 'See the orders to pack' }),
    ).toHaveAttribute('href', '/orders?show=to-pack');
    // Measured from when the orders were read, not from the clock now.
    const packed = await tile('Packed, for the courier');
    expect(packed).toHaveTextContent('1The oldest was packed 40 minutes ago.');
    expect(
      within(packed).getByRole('link', { name: 'See the packed orders' }),
    ).toHaveAttribute('href', '/orders?show=packed');
    const onTheWay = await tile('On its way');
    expect(onTheWay).toHaveTextContent('0Nothing is with a courier.');
    expect(
      within(onTheWay).getByRole('link', {
        name: 'See the orders on their way',
      }),
    ).toHaveAttribute('href', '/orders?show=on-its-way');
    const unpaid = await tile('Waiting for payment');
    expect(unpaid).toHaveTextContent('2The oldest was placed 3 hours ago.');
    expect(
      within(unpaid).getByRole('link', {
        name: 'See the orders waiting for payment',
      }),
    ).toHaveAttribute('href', '/orders?show=waiting');
    expect(await tile('Refunds on their way')).toHaveTextContent(
      '3₹1,494 in all. The oldest was asked for 25 hours ago.',
    );
    const failed = await tile('Refunds to give back by hand');
    expect(failed).toHaveTextContent(
      '1₹498 in all. Razorpay could not give these back: a Super User must, by hand.',
    );
    expect(
      within(failed).getByRole('link', { name: 'See the failed refunds' }),
    ).toHaveAttribute('href', '/orders/refunds');
    expect(
      screen.getByText('As the orders are now, whatever the period.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Live: read today at 12:15. Looks again every minute.'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Orders by status');
    const tabs = screen.getByRole('navigation', { name: 'Sales' });
    expect(within(tabs).getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('looks again every minute, as the orders list does', async () => {
    const { queryClient } = openOrders();

    await tile('To pack');
    const [orders] = queryClient
      .getQueryCache()
      .findAll({ queryKey: ['sales', 'orders'] });
    // The observer's option is kept on the query, though its type doesn't
    // say so.
    expect(
      (orders?.options as { refetchInterval?: unknown } | undefined)
        ?.refetchInterval,
    ).toBe(60_000);
  });

  it('still compares a period with no orders with the one before that had some', async () => {
    openOrders('/sales/orders', {
      [ORDERS('2026-10-27', '2026-11-25')]: () =>
        json(200, ordersOf('2026-10-27', '2026-11-25', { totals: counts({}) })),
    });

    expect(await tile('Placed')).toHaveTextContent('0Down 100% from 6');
    expect(
      screen.getByText('No order was placed in this period.'),
    ).toBeInTheDocument();
  });

  it('says nothing is to be given back by hand without alarm', async () => {
    openOrders('/sales/orders', {
      [ORDERS('2026-10-27', '2026-11-25')]: () => {
        const report = ordersOf('2026-10-27', '2026-11-25');
        return json(200, {
          ...report,
          waiting: {
            ...report.waiting,
            failedRefunds: { refunds: 0, rupees: 0, since: null },
          },
        });
      },
    });

    const failed = await tile('Refunds to give back by hand');
    expect(failed).toHaveTextContent('0None failed.');
    expect(within(failed).getByText('None failed.')).toHaveClass(
      'text-ink-muted',
    );
  });

  it('counts the orders placed in the period by where each is now, each beside the period before', async () => {
    openOrders();

    expect(await tile('Placed')).toHaveTextContent('9Up 50% from 6');
    expect(await tile('Paid for')).toHaveTextContent(
      '6Up 50% from 4, for the better67% of those placed.',
    );
    expect(await tile('Delivered')).toHaveTextContent(
      '1Down 67% from 3, for the worse11% of those placed, so far.',
    );
    // More cancels is for the worse; fewer unpaid for the better.
    const cancelled = await tile('Cancelled');
    expect(cancelled).toHaveTextContent('2Up 100% from 1, for the worse');
    expect(within(cancelled).getByText(/Up 100%/).parentElement).toHaveClass(
      'text-danger',
    );
    const expired = await tile('Not paid in time');
    expect(expired).toHaveTextContent('1Down 50% from 2, for the better');

    // Seven steps are too many for a ring: bars.
    const steps = screen.getByRole('list', { name: 'Where they are now' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'Waiting for payment1 order',
      'To pack2 orders',
      'Packed, for the courier1 order',
      'On its way1 order',
      'Delivered1 order',
      'Cancelled2 orders',
      'Not paid in time1 order',
    ]);
    // Two who cancelled: a ring, each with its share.
    const who = screen.getByRole('list', { name: 'Cancelled, by whom' });
    expect(
      within(who)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'The customer, before paying1 order50%',
      'A Super User, after paying1 order50%',
    ]);
  });

  it('follows the orders placed over time, and what became of them', async () => {
    const { user } = openOrders();

    expect(
      await screen.findByRole('heading', {
        name: 'Orders placed each day',
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('slider', { name: 'Orders placed each day' }),
    ).toHaveAttribute('aria-valuetext', '25 Nov 2026: 5. 26 Oct 2026: 4');

    const show = screen.getByRole('group', { name: 'Show' });
    await user.click(within(show).getByRole('button', { name: 'Delivered' }));
    expect(
      screen.getByRole('slider', {
        name: 'Orders placed each day: delivered since',
      }),
    ).toHaveAttribute('aria-valuetext', '25 Nov 2026: 0. 26 Oct 2026: 1');
    expect(screen.queryByText(/₹/, { selector: 'svg text' })).toBeNull();
  });

  it('draws the bars asked for, keeping the tab', async () => {
    const { user, router } = openOrders('/sales/orders', {
      [SALES('2026-10-27', '2026-11-25', '&unit=week')]: salesOf(
        '2026-10-27',
        '2026-11-25',
      ),
      [ORDERS('2026-10-27', '2026-11-25', '&unit=week')]: () =>
        json(
          200,
          ordersOf('2026-10-27', '2026-11-25', {
            series: { unit: 'week', points: [] },
          }),
        ),
    });

    await tile('Placed');
    await user.click(
      within(screen.getByRole('group', { name: 'Bars' })).getByRole('button', {
        name: 'Weeks',
      }),
    );
    expect(router.state.location.pathname).toBe('/sales/orders');
    expect(router.state.location.search).toBe('?unit=week');
    expect(
      await screen.findByRole('heading', {
        name: 'Orders placed each week',
        level: 2,
      }),
    ).toBeInTheDocument();
  });

  it('lists the refunds asked for by how each is now and by why, with neither’s empty rows', async () => {
    openOrders();

    expect(
      (await screen.findByText(/, ₹1,941 in all/)).parentElement,
    ).toHaveTextContent('4 refunds, ₹1,941 in all');
    const now = screen.getByRole('table', { name: 'By how each is now' });
    expect(
      within(now)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([
      'Back with the customer2₹945',
      'Being sent to Razorpay1₹498',
      'Given back by hand1₹498',
      'In all4₹1,941',
    ]);
    const reasons = screen.getByRole('table', { name: 'By why' });
    expect(
      within(reasons)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([
      'The customer cancelled the order1₹498',
      'A Super User cancelled the order1₹498',
      'Paid for an order already cancelled1₹498',
      'A second payment for an order already paid1₹447',
      'In all4₹1,941',
    ]);
    expect(
      screen.getByRole('link', { name: 'See every refund' }),
    ).toHaveAttribute('href', '/orders/refunds');
  });

  it('says so when no refund was asked for, or no order placed either side', async () => {
    const quiet = ordersOf('2026-10-27', '2026-11-25');
    openOrders('/sales/orders', {
      [ORDERS('2026-10-27', '2026-11-25')]: () =>
        json(200, {
          ...quiet,
          totals: counts({}),
          previousTotals: counts({}),
          refunds: {
            byStatus: quiet.refunds.byStatus.map((row) => ({
              ...row,
              refunds: 0,
              rupees: 0,
            })),
            byReason: quiet.refunds.byReason.map((row) => ({
              ...row,
              refunds: 0,
              rupees: 0,
            })),
          },
        }),
    });

    expect(
      await screen.findByText(
        'No order was placed in this period or the one before.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No refund was asked for in this period.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Placed' })).toBeNull();
    // What waits now still shows.
    expect(await tile('To pack')).toHaveTextContent('11');
  });

  it('says how it is narrowed, and that an unpaid order has no way of paying', async () => {
    openOrders('/sales/orders?method=UPI', {
      [SALES('2026-10-27', '2026-11-25', '&method=UPI')]: salesOf(
        '2026-10-27',
        '2026-11-25',
      ),
      [ORDERS('2026-10-27', '2026-11-25', '&method=UPI')]: () =>
        json(200, ordersOf('2026-10-27', '2026-11-25')),
    });

    expect(
      await screen.findByText(
        'As the orders are now, whatever the period. Narrowed as the page is: each list shows them all.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Only those paid this way: an order not paid for has no way yet\./,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the period in its tab’s link from another tab', async () => {
    const days = '?from=2026-11-01&to=2026-11-25';
    openSignedIn(`/sales${days}`, {
      staff: RAVI,
      answers: {
        [SALES('2026-11-01', '2026-11-25')]: salesOf(
          '2026-11-01',
          '2026-11-25',
        ),
      },
    });

    const tabs = await screen.findByRole('navigation', { name: 'Sales' });
    expect(within(tabs).getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      `/sales/orders${days}`,
    );
  });

  it('says calmly when the orders cannot be loaded, and tries again', async () => {
    const { user } = openOrders('/sales/orders', {
      [ORDERS('2026-10-27', '2026-11-25')]: () =>
        json(500, { message: 'Internal server error' }),
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The orders could not be loaded');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The orders could not be loaded',
      ),
    );
  });
});

describe('the orders over time', () => {
  it('puts each bar beside the same days of the period before, for what is followed', () => {
    const report = ordersOf('2026-11-01', '2026-11-14', {
      series: {
        unit: 'week',
        points: [
          {
            start: '2026-11-01',
            ...counts({ placed: 2, cancelled: 1 }),
            previous: counts({ placed: 1 }),
          },
          {
            start: '2026-11-02',
            ...counts({ placed: 1 }),
            previous: counts({}),
          },
          {
            start: '2026-11-09',
            ...counts({ placed: 5, cancelled: 2 }),
            previous: counts({ placed: 3, cancelled: 1 }),
          },
        ],
      },
    });

    const points = orderPoints(report, 'cancelled');
    expect(points.map((p) => [p.label, p.value, p.previous])).toEqual([
      ['1 Nov', 1, 0],
      ['2 Nov', 0, 0],
      ['9 Nov', 2, 1],
    ]);
    expect(points[2]?.readout).toBe('9–14 Nov 2026: 2. 26–31 Oct 2026: 1');
  });
});

describe('the parts of some orders', () => {
  it('leaves out those with none, each keeping its colour', () => {
    const parts = partsOf(counts({ placed: 3, toPack: 1, delivered: 2 }), [
      { key: 'waitingForPayment', name: 'Waiting', colour: 1 },
      { key: 'toPack', name: 'To pack', colour: 2 },
      { key: 'delivered', name: 'Delivered', colour: 5 },
    ]);
    expect(parts).toEqual([
      {
        key: 'toPack',
        name: 'To pack',
        value: 1,
        colour: 2,
        figure: '1 order',
      },
      {
        key: 'delivered',
        name: 'Delivered',
        value: 2,
        colour: 5,
        figure: '2 orders',
      },
    ]);
  });
});

describe('how long something has waited', () => {
  it('says it in minutes, hours, then days', () => {
    const at = '2026-11-25T06:45:00.000Z';
    expect(waitedName('2026-11-25T06:44:30.000Z', at)).toBe('under a minute');
    expect(waitedName('2026-11-25T06:44:00.000Z', at)).toBe('1 minute');
    expect(waitedName('2026-11-25T05:46:00.000Z', at)).toBe('59 minutes');
    expect(waitedName('2026-11-25T05:45:00.000Z', at)).toBe('1 hour');
    expect(waitedName('2026-11-23T06:46:00.000Z', at)).toBe('47 hours');
    expect(waitedName('2026-11-23T06:45:00.000Z', at)).toBe('2 days');
    // A clock a little ahead never says "−1 minutes".
    expect(waitedName('2026-11-25T06:46:00.000Z', at)).toBe('under a minute');
  });
});
