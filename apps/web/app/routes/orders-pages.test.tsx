import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../test/render.tsx';
import Orders from './orders.tsx';

// The customer's orders (part 14D), as drawn and read out.
const FIRST = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const SECOND = '9b2d4c6e-8f1a-4b3c-9d5e-7f6a8b9c0d1e';
const THIRD = '1c3e5a7b-9d2f-4a6c-8e1b-3d5f7a9c2e4b';
const shown = (id: string, more: Record<string, unknown> = {}) => ({
  id,
  reference: '7KQ2M9XDPA',
  what: 'Ashwagandha Capsules and 2 more',
  placedAt: '2026-11-07T20:42:38.771Z',
  placedOn: '8 Nov 2026',
  standing: 'PAID',
  payBy: null,
  totalRupees: 1347,
  ...more,
});

function openOrders(
  first: Record<string, unknown>,
  later?: Record<string, unknown>,
  url = '/orders',
) {
  renderPage({
    path: '/orders',
    url,
    Component: Orders as never,
    loader: ({ request }) => {
      const before = new URL(request.url).searchParams.get('before');
      return {
        orders: [],
        nextBefore: null,
        before,
        origin: 'https://shop.example.com',
        ...(before && later ? later : first),
      };
    },
  });
}

describe('the list of orders', () => {
  it('shows each order: what is in it, when it was placed, its reference, where it stands and its total, the whole card a link to it', async () => {
    openOrders({
      orders: [
        shown(FIRST),
        shown(SECOND, {
          reference: 'ABCDEFGH23',
          what: 'Tulsi Drops',
          standing: 'PENDING_PAYMENT',
          payBy: '8:27 pm',
          totalRupees: 498,
        }),
      ],
    });
    expect(
      await screen.findByRole('heading', { name: 'Your orders', level: 1 }),
    ).toBeInTheDocument();
    const [paid, waiting] = screen.getAllByRole('article');
    if (!paid || !waiting) {
      throw new Error('two orders expected');
    }
    expect(
      within(paid).getByRole('link', {
        name: 'Ashwagandha Capsules and 2 more, order 7KQ2M9XDPA',
      }),
    ).toHaveAttribute('href', `/orders/${FIRST}`);
    expect(paid.querySelector('time')).toHaveTextContent(
      'Placed on 8 Nov 2026',
    );
    expect(paid).toHaveTextContent('Order 7KQ2M9XDPA');
    expect(paid.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-11-07T20:42:38.771Z',
    );
    expect(paid).toHaveTextContent('Paid');
    expect(paid).toHaveTextContent('₹1,347');
    expect(
      within(waiting).getByRole('link', {
        name: 'Tulsi Drops, order ABCDEFGH23',
      }),
    ).toHaveAttribute('href', `/orders/${SECOND}`);
    expect(waiting).toHaveTextContent('Waiting for payment');
    expect(waiting).toHaveTextContent('Pay by 8:27 pm');
    expect(waiting).toHaveTextContent('₹498');
  });

  it('says each order’s standing in words', async () => {
    const said = {
      PENDING_PAYMENT: 'Waiting for payment',
      HOLD_OVER: 'Time to pay is over',
      PAID: 'Paid',
      PACKED: 'Packed',
      SHIPPED: 'On its way',
      DELIVERED: 'Delivered',
      CANCELLED: 'Cancelled',
      EXPIRED: 'Not paid in time',
    };
    const ids = [FIRST, SECOND, THIRD].concat(
      Array.from(
        { length: 5 },
        (_, index) => `${String(index).repeat(8)}-0000-4000-8000-000000000000`,
      ),
    );
    openOrders({
      orders: Object.keys(said).map((standing, index) =>
        shown(ids[index] ?? '', { standing }),
      ),
    });
    await screen.findAllByRole('article');
    expect(
      screen
        .getAllByRole('article')
        .map((card) => card.lastElementChild?.textContent),
    ).toEqual(Object.values(said));
  });

  it('with no orders yet, says so, and the way to the shop', async () => {
    openOrders({ orders: [] });
    expect(
      await screen.findByText('You have not placed an order yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the shop' }),
    ).toHaveAttribute('href', '/shop');
    expect(screen.queryByRole('link', { name: 'Show more orders' })).toBeNull();
  });

  it('opened as a later page, has the way back to the newest, and says when nothing is left', async () => {
    openOrders({ orders: [] }, { orders: [] }, `/orders?before=${SECOND}`);
    expect(
      await screen.findByText('There are no more orders to show.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to your newest orders' }),
    ).toHaveAttribute('href', '/orders');
    expect(screen.queryByText('You have not placed an order yet.')).toBeNull();
  });

  it('“Show more orders” adds the next ones in place, says how many, and the keyboard lands on the first of them', async () => {
    openOrders(
      { orders: [shown(FIRST)], nextBefore: FIRST },
      {
        // The first again, should it be on two pages: shown once.
        orders: [
          shown(FIRST),
          shown(SECOND, { what: 'Tulsi Drops', reference: 'ABCDEFGH23' }),
        ],
        nextBefore: null,
      },
    );
    const more = await screen.findByRole('link', { name: 'Show more orders' });
    expect(more).toHaveAttribute('href', `/orders?before=${FIRST}`);
    await userEvent.click(more);
    const added = await screen.findByRole('link', {
      name: 'Tulsi Drops, order ABCDEFGH23',
    });
    await waitFor(() => expect(added).toHaveFocus());
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('1 more order shown.');
    expect(screen.queryByRole('link', { name: 'Show more orders' })).toBeNull();
    // Still the first page: no way back is needed.
    expect(
      screen.queryByRole('link', { name: 'Back to your newest orders' }),
    ).toBeNull();
  });
});
