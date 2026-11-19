import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UNREACHABLE } from '../api/api-error';
import { heldBack, openSignedIn } from '../test/console';
import { json, offline } from '../test/fake-api';
import {
  CANCELLED,
  DELIVERED,
  ORDERS,
  PACKED,
  PAID,
  PAID_LATER,
  SHIPPED,
  STEP,
  TO_PACK,
  WAITING,
  forAdmin,
  orderOf,
  ordersOf,
  summaryOf,
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

// A third paid order, placed last.
const PAID_LAST = {
  ...PAID_LATER,
  id: '7c0f5d2b-6e4a-4b1d-8f9c-5a8e1b4d0f63',
  reference: 'R7WX4N2KTB',
  createdAt: '2026-11-09T09:02:17.400Z',
  delivery: {
    ...PAID_LATER.delivery,
    fullName: 'Meera Pillai',
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682016',
  },
};

const packedOf = (order: typeof PAID) => ({
  ...forAdmin(order),
  status: 'PACKED',
  packedAt: '2026-11-09T10:15:00.000Z',
});
const packing = (order: typeof PAID) => `/v1/staff/orders/${order.id}/packed`;
const box = (reference: string) =>
  screen.getByRole('checkbox', { name: `Choose ${reference}` });
const chooseAll = () =>
  screen.getByRole('checkbox', { name: 'Choose all shown' });
const button = (name: string) => screen.getByRole('button', { name });

// The rows of the dialog's list, top to bottom.
const dialogRows = (dialog: HTMLElement) =>
  within(
    within(dialog).getByRole('list', { name: 'Chosen orders' }),
  ).getAllByRole('listitem');

// Ticks orders, then says yes in the dialog.
async function packChosen(
  user: Awaited<ReturnType<typeof openOrders>>['user'],
  count: number,
) {
  await user.click(button(`Mark ${count} packed`));
  const asking = await screen.findByRole('dialog');
  await user.click(
    within(asking).getByRole('button', {
      name: count === 1 ? 'Mark packed' : `Mark ${count} packed`,
    }),
  );
}

describe('packing several at once', () => {
  it('marks the ticked orders packed together, one at a time', async () => {
    const first = heldBack();
    const reread = heldBack();
    const { user, api } = await openOrders({
      answers: {
        [TO_PACK_LIST]: [
          ordersOf([PAID, PAID_LATER, PAID_LAST]),
          reread.answer,
        ],
        [STEP(PAID, 'packed')]: first.answer,
        [STEP(PAID_LAST, 'packed')]: orderOf(packedOf(PAID_LAST)),
      },
    });
    await references();
    expect(screen.queryByText(/chosen$/)).not.toBeInTheDocument();

    await user.click(box(PAID.reference));
    await user.click(box(PAID_LAST.reference));
    expect(screen.getByText('2 chosen')).toBeInTheDocument();
    await user.click(button('Mark 2 packed'));

    const asking = await screen.findByRole('dialog', {
      name: 'Mark 2 orders packed?',
    });
    expect(asking).toHaveTextContent(
      'Only once every box is packed and closed. Each customer gets an email saying so',
    );
    const rows = dialogRows(asking);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(
      `${PAID.reference} · Asha K, Bengaluru, Karnataka`,
    );
    expect(rows[1]).toHaveTextContent(
      `${PAID_LAST.reference} · Meera Pillai, Kochi, Kerala`,
    );
    // Nothing goes until staff say so.
    expect(api.to('POST', packing(PAID))).toEqual([]);

    await user.click(
      within(asking).getByRole('button', { name: 'Mark 2 packed' }),
    );
    await waitFor(() => expect(api.to('POST', packing(PAID))).toHaveLength(1));
    expect(
      within(asking).getByRole('button', { name: 'Marking 1 of 2…' }),
    ).toBeInTheDocument();
    expect(within(asking).getByText('0 of 2 done')).toBeInTheDocument();
    // One at a time: the next waits for the first answer.
    expect(api.to('POST', packing(PAID_LAST))).toEqual([]);

    first.release(json(200, packedOf(PAID)));

    expect(await screen.findByText('2 orders packed')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.to('POST', packing(PAID_LAST))).toHaveLength(1);
    expect(api.to('POST', packing(PAID_LATER))).toEqual([]);
    // None stays chosen, even before the list has read again.
    await waitFor(() =>
      expect(screen.queryByText(/chosen$/)).not.toBeInTheDocument(),
    );
    expect(box(PAID.reference)).not.toBeChecked();
    expect(box(PAID_LAST.reference)).not.toBeChecked();

    // Those packed leave the list when it has.
    reread.release(
      json(200, { orders: [summaryOf(PAID_LATER)], nextAfter: null }),
    );
    await waitFor(async () =>
      expect(await references()).toEqual([PAID_LATER.reference]),
    );
    expect(api.unexpected).toEqual([]);
  });

  it('ticks all shown or none, half ticked while some are', async () => {
    const { user } = await openOrders();
    await references();

    await user.click(box(PAID.reference));
    expect(chooseAll()).toBePartiallyChecked();
    await user.click(box(PAID.reference));
    expect(box(PAID.reference)).not.toBeChecked();
    await user.click(box(PAID.reference));

    await user.click(chooseAll());
    expect(chooseAll()).toBeChecked();
    expect(box(PAID_LATER.reference)).toBeChecked();
    expect(screen.getByText('2 chosen')).toBeInTheDocument();

    // The bar says how much of the bottom it takes, for the notes to rise
    // above it (bottom-bar.ts), and stops saying so once it has gone.
    const reserved = () =>
      document.documentElement.style.getPropertyValue('--bottom-bar');
    expect(reserved()).not.toBe('');

    await user.click(chooseAll());
    expect(box(PAID.reference)).not.toBeChecked();
    expect(box(PAID_LATER.reference)).not.toBeChecked();
    await waitFor(() =>
      expect(screen.queryByText(/chosen$/)).not.toBeInTheDocument(),
    );
    expect(reserved()).toBe('');

    await user.click(box(PAID_LATER.reference));
    await user.click(button('Clear the choice'));
    expect(box(PAID_LATER.reference)).not.toBeChecked();
    expect(chooseAll()).not.toBePartiallyChecked();
  });

  it('asks about one order by its reference, and sends nothing until told', async () => {
    const { user, api } = await openOrders();
    await references();

    await user.click(box(PAID_LATER.reference));
    expect(screen.getByText('1 chosen')).toBeInTheDocument();
    await user.click(button('Mark 1 packed'));
    const asking = await screen.findByRole('dialog', {
      name: `Mark ${PAID_LATER.reference} packed?`,
    });
    expect(asking).toHaveTextContent(
      'Only once its box is packed and closed. The customer gets an email saying so',
    );
    expect(
      within(asking).getByRole('button', { name: 'Mark packed' }),
    ).toBeInTheDocument();

    await user.click(within(asking).getByRole('button', { name: 'Not yet' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.to('POST', packing(PAID_LATER))).toEqual([]);
    expect(box(PAID_LATER.reference)).toBeChecked();
  });

  it('goes on past an order packed meanwhile, and says why it was not', async () => {
    const { user, api } = await openOrders({
      answers: {
        [TO_PACK_LIST]: [ordersOf([PAID, PAID_LATER]), ordersOf([])],
        [STEP(PAID, 'packed')]: () =>
          json(409, { message: 'This order is packed already.' }),
        [STEP(PAID_LATER, 'packed')]: orderOf(packedOf(PAID_LATER)),
      },
    });
    await references();
    await user.click(chooseAll());
    await packChosen(user, 2);

    const told = await screen.findByRole('dialog', { name: '1 of 2 packed' });
    const alert = within(told).getByRole('alert');
    expect(alert).toHaveTextContent(
      'One order was not packed. The reason is under it.',
    );
    expect(alert).not.toHaveTextContent('chosen');
    const [refused, packed] = dialogRows(told);
    expect(refused).toHaveTextContent('This order is packed already.');
    expect(packed).toHaveTextContent('Packed');
    expect(api.to('POST', packing(PAID_LATER))).toHaveLength(1);
    expect(
      await screen.findByText(`${PAID_LATER.reference} packed`),
    ).toBeInTheDocument();

    await user.click(within(told).getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Nothing to pack')).toBeInTheDocument();
    expect(screen.queryByText(/chosen$/)).not.toBeInTheDocument();
  });

  it('reads the list again when every one was refused', async () => {
    const { user, api } = await openOrders({
      answers: {
        [TO_PACK_LIST]: [ordersOf([PAID, PAID_LATER]), ordersOf([PAID_LATER])],
        [STEP(PAID, 'packed')]: () =>
          json(409, { message: 'This order is cancelled.' }),
      },
    });
    await references();
    await user.click(box(PAID.reference));
    await packChosen(user, 1);

    const told = await screen.findByRole('dialog', { name: '0 of 1 packed' });
    expect(told).toHaveTextContent('This order is cancelled.');
    await waitFor(async () =>
      expect(await references()).toEqual([PAID_LATER.reference]),
    );
    expect(api.to('GET', TO_PACK_LIST.slice(4))).toHaveLength(2);
  });

  it('stops when the server cannot be reached, and keeps the rest chosen to try again', async () => {
    const { user, api } = await openOrders({
      answers: {
        [TO_PACK_LIST]: [
          ordersOf([PAID, PAID_LATER, PAID_LAST]),
          ordersOf([PAID_LATER, PAID_LAST]),
        ],
        [STEP(PAID, 'packed')]: orderOf(packedOf(PAID)),
        [STEP(PAID_LATER, 'packed')]: offline,
      },
    });
    await references();
    await user.click(chooseAll());
    await packChosen(user, 3);

    const told = await screen.findByRole('dialog', { name: '1 of 3 packed' });
    expect(within(told).getByRole('alert')).toHaveTextContent(
      '2 orders were not packed. The reason is under each. Those still to pack stay chosen, to try again.',
    );
    const rows = dialogRows(told);
    expect(rows[0]).toHaveTextContent('Packed');
    expect(rows[1]).toHaveTextContent(UNREACHABLE);
    expect(rows[2]).toHaveTextContent('Not sent');
    // The rest would only fail the same way.
    expect(api.to('POST', packing(PAID_LAST))).toEqual([]);

    await user.click(within(told).getByRole('button', { name: 'Close' }));
    await waitFor(async () =>
      expect(await references()).toEqual([
        PAID_LATER.reference,
        PAID_LAST.reference,
      ]),
    );
    expect(box(PAID_LATER.reference)).toBeChecked();
    expect(box(PAID_LAST.reference)).toBeChecked();

    // Trying again starts afresh.
    await user.click(button('Mark 2 packed'));
    const again = await screen.findByRole('dialog', {
      name: 'Mark 2 orders packed?',
    });
    expect(again).not.toHaveTextContent('Not sent');
    expect(again).not.toHaveTextContent(UNREACHABLE);
  });

  it('offers ticks only on the To pack list, and forgets them on another chip', async () => {
    const toPack = heldBack();
    const { user } = await openOrders(
      {
        answers: {
          [ORDERS('?status=PACKED&sort=oldest')]: ordersOf([PACKED]),
          [TO_PACK_LIST]: [toPack.answer, ordersOf([PAID, PAID_LATER])],
        },
      },
      '/orders?show=packed',
    );
    await references();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    // While the To pack list loads, the packed one still shows: no ticks.
    await user.click(chip('To pack'));
    expect(chip('To pack')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    toPack.release(
      json(200, { orders: [PAID, PAID_LATER].map(summaryOf), nextAfter: null }),
    );
    await user.click(
      await screen.findByRole('checkbox', { name: `Choose ${PAID.reference}` }),
    );
    expect(screen.getByText('1 chosen')).toBeInTheDocument();

    await user.click(chip('Packed'));
    await waitFor(() =>
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(),
    );
    await user.click(chip('To pack'));
    expect(
      await screen.findByRole('checkbox', { name: `Choose ${PAID.reference}` }),
    ).not.toBeChecked();
  });

  it('offers no ticks while a reference is searched', async () => {
    await openOrders(
      {
        answers: {
          [ORDERS(`?reference=${PAID.reference}`)]: ordersOf([PAID]),
        },
      },
      `/orders?reference=${PAID.reference}`,
    );

    expect(await references()).toEqual([PAID.reference]);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
