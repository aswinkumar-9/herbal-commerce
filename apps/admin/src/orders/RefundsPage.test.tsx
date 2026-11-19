import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { openSignedIn } from '../test/console';
import { RAVI, json } from '../test/fake-api';
import {
  CANCELLED,
  FAILED_REFUND,
  ORDER,
  ORDERS,
  PAID,
  PAID_LATER,
  REFUND,
  REFUNDS,
  listed,
  orderOf,
  ordersOf,
  refundsOf,
} from '../test/order-fixtures';

const FAILED_LIST = REFUNDS('?status=FAILED');
const EVERY_LIST = REFUNDS();
const failed = listed(FAILED_REFUND, PAID_LATER);
const pending = listed(REFUND, CANCELLED);

function openRefunds(
  answers: NonNullable<Parameters<typeof openSignedIn>[1]>['answers'] = {},
  path = '/orders/refunds',
) {
  return openSignedIn(path, {
    staff: RAVI,
    answers: {
      [ORDERS('?status=PAID&sort=oldest')]: ordersOf([PAID]),
      [FAILED_LIST]: refundsOf([failed]),
      [EVERY_LIST]: refundsOf([failed, pending]),
      ...answers,
    },
  });
}

const tabs = () =>
  screen.getByRole('navigation', { name: 'Orders and refunds' });
const failedCard = () =>
  screen.getByRole('region', { name: 'Failed: give these back by hand' });
const rows = (name: string) =>
  within(screen.getByRole('list', { name })).getAllByRole('listitem');

describe('the Refunds tab', () => {
  it('opens from the Orders page for a Super User', async () => {
    const { user, router, api } = openRefunds({}, '/orders');
    await screen.findByRole('heading', { name: 'Orders', level: 1 });
    expect(
      within(tabs()).getByRole('link', { name: 'Orders' }),
    ).toHaveAttribute('aria-current', 'page');

    await user.click(within(tabs()).getByRole('link', { name: 'Refunds' }));

    expect(
      await screen.findByRole('heading', { name: 'Refunds', level: 1 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/orders/refunds');
    expect(document.title).toBe('Refunds · Herbal Commerce Admin');
    expect(
      within(tabs()).getByRole('link', { name: 'Refunds' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(tabs()).getByRole('link', { name: 'Orders' }),
    ).not.toHaveAttribute('aria-current');
    await screen.findByRole('list', { name: 'Every refund' });
    expect(api.unexpected).toEqual([]);
  });

  it('puts the failed ones first, saying to give the money back by hand', async () => {
    openRefunds();

    const [only, ...more] = within(
      await screen.findByRole('list', { name: 'Failed refunds' }),
    ).getAllByRole('listitem');
    expect(more).toEqual([]);
    expect(failedCard()).toHaveTextContent(
      'Razorpay could not give this money back. Give each back by hand in the Razorpay dashboard, from the payment named on it',
    );
    // How much, where it stands since when (in India), why, and the payment
    // to find in the dashboard.
    expect(only).toHaveTextContent('₹498');
    expect(only).toHaveTextContent('Failed: give it back by hand');
    expect(only).toHaveTextContent('12 Nov 2026, 15:35');
    expect(only).toHaveTextContent(
      'A second payment for an order already paid',
    );
    expect(only).toHaveTextContent('Started12 Nov 2026, 15:30');
    expect(only).toHaveTextContent('Razorpay paymentpay_G3P9vcIhRs3NV4');
    expect(only).not.toHaveTextContent('Razorpay refund');
    expect(
      within(only!).getByRole('link', {
        name: `Order ${PAID_LATER.reference}`,
      }),
    ).toHaveAttribute('href', `/orders/${PAID_LATER.id}`);
  });

  it('lists every refund, the newest first, each with its order', async () => {
    openRefunds();

    await screen.findByRole('list', { name: 'Every refund' });
    const [first, second] = rows('Every refund');
    expect(first).toHaveTextContent('Failed: give it back by hand');
    expect(second).toHaveTextContent('₹929');
    expect(second).toHaveTextContent('On its way back');
    expect(second).toHaveTextContent('A Super User cancelled the order');
    expect(second).toHaveTextContent('Razorpay refundrfnd_RCe7Qm0LhZ2xYw');
    expect(
      within(second!).getByRole('link', {
        name: `Order ${CANCELLED.reference}`,
      }),
    ).toHaveAttribute('href', `/orders/${CANCELLED.id}`);
  });

  it('leads to the order, and back to the refunds', async () => {
    const { user, router } = openRefunds({
      [ORDER(PAID_LATER)]: orderOf(PAID_LATER),
    });
    const list = await screen.findByRole('list', { name: 'Failed refunds' });

    await user.click(
      within(list).getByRole('link', { name: `Order ${PAID_LATER.reference}` }),
    );

    expect(
      await screen.findByRole('heading', {
        name: `Order ${PAID_LATER.reference}`,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Refunds' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/orders/refunds'),
    );
    expect(
      await screen.findByRole('heading', { name: 'Refunds', level: 1 }),
    ).toBeInTheDocument();
  });

  it('leads back to the refunds from an order that cannot be found', async () => {
    const { user, router } = openRefunds({
      [ORDER(PAID_LATER)]: () => json(404, { message: 'Order not found' }),
    });
    const list = await screen.findByRole('list', { name: 'Failed refunds' });
    await user.click(
      within(list).getByRole('link', { name: `Order ${PAID_LATER.reference}` }),
    );

    await user.click(
      await screen.findByRole('link', { name: 'Back to the refunds' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/orders/refunds'),
    );
  });

  it('shows no failed card when none failed, and says when there are no refunds', async () => {
    openRefunds({
      [FAILED_LIST]: refundsOf([]),
      [EVERY_LIST]: refundsOf([]),
    });

    expect(await screen.findByText('No refunds yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Failed: give these back by hand' }),
    ).not.toBeInTheDocument();
  });

  it('says when the failed refunds could not be loaded, and tries again', async () => {
    const { user } = openRefunds({
      [FAILED_LIST]: [
        () => json(503, { message: 'Service Unavailable' }),
        refundsOf([failed]),
      ],
    });

    expect(
      await screen.findByText('The failed refunds could not be loaded'),
    ).toBeInTheDocument();
    // Every refund still shows.
    await screen.findByRole('list', { name: 'Every refund' });

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('list', { name: 'Failed refunds' }),
    ).toBeInTheDocument();
  });

  it('says when every refund could not be loaded, and tries again', async () => {
    const { user } = openRefunds({
      [EVERY_LIST]: [
        () => json(503, { message: 'Service Unavailable' }),
        refundsOf([pending]),
      ],
    });

    expect(
      await screen.findByText('The refunds could not be loaded'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(rows('Every refund')).toHaveLength(1));
  });

  it('shows more of each a page at a time', async () => {
    const { user } = openRefunds({
      [FAILED_LIST]: refundsOf([failed], failed.id),
      [REFUNDS(`?status=FAILED&after=${failed.id}`)]: refundsOf([
        { ...failed, id: 'e5f4a3b2-1c0d-4e9f-8a7b-6c5d4e3f2a11' },
      ]),
      [EVERY_LIST]: refundsOf([pending], pending.id),
      [REFUNDS(`?after=${pending.id}`)]: refundsOf([failed]),
    });
    await screen.findByRole('list', { name: 'Every refund' });

    await user.click(
      screen.getByRole('button', { name: 'Show more failed refunds' }),
    );
    await waitFor(() => expect(rows('Failed refunds')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(rows('Every refund')).toHaveLength(2));
    expect(
      screen.queryByRole('button', { name: /^Show more/ }),
    ).not.toBeInTheDocument();
  });

  it('is for Super Users only: an Admin sees no tabs, and no refunds', async () => {
    const { api } = openSignedIn('/orders/refunds', {
      answers: { [ORDERS('?status=PAID&sort=oldest')]: ordersOf([PAID]) },
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Only Super Users can open this page',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Orders and refunds' }),
    ).not.toBeInTheDocument();
    expect(
      api.sent.some((sent) => sent.path.startsWith('/v1/staff/refunds')),
    ).toBe(false);
  });

  it('shows an Admin the orders without tabs', async () => {
    openSignedIn('/orders', {
      answers: { [ORDERS('?status=PAID&sort=oldest')]: ordersOf([PAID]) },
    });

    await screen.findByRole('list', { name: 'Orders' });
    expect(
      screen.queryByRole('navigation', { name: 'Orders and refunds' }),
    ).not.toBeInTheDocument();
  });
});
