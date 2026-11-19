import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { openSignedIn } from '../test/console';
import { json } from '../test/fake-api';
import {
  CANCELLED,
  DELIVERED,
  ORDERS,
  PACKED,
  PAID,
  PAID_LATER,
  SHIPPED,
  TO_PACK,
  WAITING,
  ordersOf,
} from '../test/order-fixtures';

const TO_PACK_LIST = ORDERS('?status=PAID&sort=oldest');

async function openOrders(
  options: Parameters<typeof openSignedIn>[1] = {},
  path = '/orders',
) {
  const console = openSignedIn(path, {
    ...options,
    answers: {
      [TO_PACK_LIST]: ordersOf([PAID, PAID_LATER]),
      ...options.answers,
    },
  });
  await screen.findByRole('heading', { name: 'Orders', level: 1 });
  return console;
}

// The orders on the page, top to bottom, by reference.
async function references() {
  const list = await screen.findByRole('list', { name: 'Orders' });
  return within(list)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('a')?.firstChild?.textContent);
}

const chip = (name: string) => screen.getByRole('button', { name });
const search = () => screen.getByLabelText('Find an order by its reference');

describe('the Orders page', () => {
  it('opens from the menu on the orders to pack, the oldest first', async () => {
    const { user, api } = openSignedIn('/', {
      answers: { [TO_PACK_LIST]: ordersOf([PAID, PAID_LATER]) },
    });
    const menu = await screen.findByRole('navigation', { name: 'Main' });
    await user.click(within(menu).getByRole('link', { name: 'Orders' }));

    expect(await references()).toEqual([PAID.reference, PAID_LATER.reference]);
    expect(document.title).toBe('Orders · Herbal Commerce Admin');
    expect(chip('To pack')).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText('Paid orders waiting to be packed, the oldest first.'),
    ).toBeInTheDocument();
    const [first] = within(
      screen.getByRole('list', { name: 'Orders' }),
    ).getAllByRole('listitem');
    // Who, where, when (in India) and how much, in whole rupees.
    expect(first).toHaveTextContent('Asha K · Bengaluru, Karnataka');
    expect(first).toHaveTextContent('Placed 9 Nov 2026, 10:40');
    expect(first).toHaveTextContent('₹929');
    // Every order here is to pack: no tag says so on each.
    expect(first).not.toHaveTextContent('To pack');
    expect(api.unexpected).toEqual([]);
  });

  it('shows how many orders wait to be packed beside Orders in the menu', async () => {
    await openOrders({
      answers: { [TO_PACK]: ordersOf([PAID, PAID_LATER]) },
    });
    const menu = screen.getByRole('navigation', { name: 'Main' });

    expect(
      await within(menu).findByRole('link', { name: 'Orders: 2 to pack' }),
    ).toBeInTheDocument();
  });

  it('shows 99+ when 100 or more wait', async () => {
    await openOrders({ answers: { [TO_PACK]: ordersOf([PAID], PAID.id) } });
    const menu = screen.getByRole('navigation', { name: 'Main' });

    expect(
      await within(menu).findByRole('link', { name: 'Orders: 99+ to pack' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['nothing waits', ordersOf([])],
    ['the count cannot be read', () => json(500, {})],
  ])('shows no count when %s', async (_, answer) => {
    const { api } = await openOrders({ answers: { [TO_PACK]: answer } });
    const menu = screen.getByRole('navigation', { name: 'Main' });
    await waitFor(() =>
      expect(api.to('GET', TO_PACK.slice(4))).toHaveLength(1),
    );
    await references();

    const link = within(menu).getByRole('link', { name: 'Orders' });
    expect(link).toHaveTextContent(/^Orders$/);
  });

  it('shows each step with its chip, keeping the choice in the address', async () => {
    const { user, router, api } = await openOrders({
      answers: {
        [ORDERS('?status=PACKED&sort=oldest')]: ordersOf([PACKED]),
        [ORDERS('?status=SHIPPED&sort=oldest')]: ordersOf([SHIPPED]),
        [ORDERS('?status=DELIVERED')]: ordersOf([DELIVERED]),
        [ORDERS('?status=CANCELLED')]: ordersOf([CANCELLED]),
        [ORDERS('?status=PENDING_PAYMENT')]: ordersOf([WAITING]),
        [ORDERS('?status=EXPIRED')]: ordersOf([]),
        [ORDERS()]: ordersOf([WAITING, PAID_LATER, SHIPPED]),
      },
    });
    await references();

    await user.click(chip('Packed'));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?show=packed'),
    );
    expect(chip('Packed')).toHaveAttribute('aria-pressed', 'true');
    expect(
      await screen.findByText(
        'Packed orders waiting for the courier, the oldest first.',
      ),
    ).toBeInTheDocument();

    for (const name of [
      'On its way',
      'Delivered',
      'Cancelled',
      'Waiting for payment',
    ]) {
      await user.click(chip(name));
      await waitFor(() =>
        expect(chip(name)).toHaveAttribute('aria-pressed', 'true'),
      );
    }

    await user.click(chip('All'));
    await waitFor(() => expect(router.state.location.search).toBe('?show=all'));
    await waitFor(async () =>
      expect(await references()).toEqual([
        WAITING.reference,
        PAID_LATER.reference,
        SHIPPED.reference,
      ]),
    );
    // A list of every step tags each order with its own.
    const rows = within(
      screen.getByRole('list', { name: 'Orders' }),
    ).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Waiting for payment');
    expect(rows[1]).toHaveTextContent('To pack');
    expect(rows[2]).toHaveTextContent('On its way');

    await user.click(chip('To pack'));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(api.unexpected).toEqual([]);
  });

  it('opens on the step in the address, and on the orders to pack for one it does not know', async () => {
    await openOrders(
      { answers: { [ORDERS('?status=DELIVERED')]: ordersOf([DELIVERED]) } },
      '/orders?show=delivered',
    );
    expect(await references()).toEqual([DELIVERED.reference]);
    expect(chip('Delivered')).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens on the orders to pack for a step it does not know', async () => {
    await openOrders({}, '/orders?show=lost');

    expect(await references()).toEqual([PAID.reference, PAID_LATER.reference]);
    expect(chip('To pack')).toHaveAttribute('aria-pressed', 'true');
  });

  it('finds an order by its reference, whatever its step, once all 10 are typed', async () => {
    const byReference = ORDERS(`?reference=${SHIPPED.reference}`);
    const { user, router, api } = await openOrders({
      answers: { [byReference]: ordersOf([SHIPPED]) },
    });
    await references();

    await user.type(search(), '7kq2 m9xd');
    // Not a whole reference yet: nothing is sent.
    expect(api.to('GET', '/v1/staff/orders?reference=7KQ2M9XD')).toEqual([]);
    expect(chip('To pack')).toHaveAttribute('aria-pressed', 'true');

    await user.type(search(), 'pa');
    await waitFor(() =>
      expect(router.state.location.search).toBe(
        `?reference=${SHIPPED.reference}`,
      ),
    );
    await waitFor(async () =>
      expect(await references()).toEqual([SHIPPED.reference]),
    );
    expect(
      screen.getByText(
        `The order with the reference ${SHIPPED.reference}, whatever its step.`,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Orders' })).getByText(
        'On its way',
      ),
    ).toBeInTheDocument();
    // No chip is chosen while a reference is.
    expect(chip('To pack')).toHaveAttribute('aria-pressed', 'false');

    await user.clear(search());
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await references()).toEqual([PAID.reference, PAID_LATER.reference]);
    expect(api.unexpected).toEqual([]);
  });

  it('says when no order has the reference', async () => {
    const { user, router } = await openOrders(
      { answers: { [ORDERS('?reference=ZZZZZZZZZZ')]: ordersOf([]) } },
      '/orders?reference=zzzzzzzzzz',
    );

    expect(
      await screen.findByText('No order has this reference'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the search' }));

    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await references()).toEqual([PAID.reference, PAID_LATER.reference]);
    expect(search()).toHaveValue('');
  });

  it('leaves the reference behind when a chip is chosen', async () => {
    const { user, router } = await openOrders(
      {
        answers: {
          [ORDERS(`?reference=${SHIPPED.reference}`)]: ordersOf([SHIPPED]),
          [ORDERS('?status=PACKED&sort=oldest')]: ordersOf([PACKED]),
        },
      },
      `/orders?reference=${SHIPPED.reference}`,
    );
    expect(search()).toHaveValue(SHIPPED.reference);

    await user.click(chip('Packed'));

    await waitFor(() =>
      expect(router.state.location.search).toBe('?show=packed'),
    );
    expect(search()).toHaveValue('');
    expect(chip('Packed')).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a reference in the address that cannot be one', async () => {
    await openOrders({}, '/orders?reference=../refunds');

    expect(await references()).toEqual([PAID.reference, PAID_LATER.reference]);
  });

  it('says calmly when there is nothing to pack, and offers every order', async () => {
    const { user, router } = await openOrders({
      answers: {
        [TO_PACK_LIST]: ordersOf([]),
        [ORDERS()]: ordersOf([DELIVERED]),
      },
    });

    expect(await screen.findByText('Nothing to pack')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Every paid order is packed. New ones appear here by themselves.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all orders' }));

    await waitFor(() => expect(router.state.location.search).toBe('?show=all'));
    expect(await references()).toEqual([DELIVERED.reference]);
  });

  it('offers nothing more when there are no orders at all', async () => {
    await openOrders(
      { answers: { [ORDERS()]: ordersOf([]) } },
      '/orders?show=all',
    );

    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show all orders' }),
    ).not.toBeInTheDocument();
  });

  it('says when the orders could not be loaded, and tries again', async () => {
    const { user } = await openOrders({
      answers: {
        [TO_PACK_LIST]: [
          () => json(503, { message: 'Service Unavailable' }),
          ordersOf([PAID]),
        ],
      },
    });

    expect(
      await screen.findByText('The orders could not be loaded'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await references()).toEqual([PAID.reference]);
  });

  it('shows more orders a page at a time', async () => {
    const { user } = await openOrders({
      answers: {
        [TO_PACK_LIST]: ordersOf([PAID], PAID.id),
        [ORDERS(`?status=PAID&sort=oldest&after=${PAID.id}`)]: ordersOf([
          PAID_LATER,
        ]),
      },
    });
    expect(await references()).toEqual([PAID.reference]);

    await user.click(screen.getByRole('button', { name: 'Show more' }));

    await waitFor(async () =>
      expect(await references()).toEqual([
        PAID.reference,
        PAID_LATER.reference,
      ]),
    );
    expect(
      screen.queryByRole('button', { name: 'Show more' }),
    ).not.toBeInTheDocument();
  });
});
