import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { openSignedIn } from '../test/console';
import { RAVI, json } from '../test/fake-api';
import {
  CANCELLED,
  DELIVERED,
  FAILED_REFUND,
  ORDER,
  ORDERS,
  PACKED,
  PAID,
  REFUND,
  SHIPPED,
  STEP,
  TO_PACK,
  WAITING,
  forAdmin,
  orderOf,
  ordersOf,
} from '../test/order-fixtures';

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

async function openOrder(
  order: { id: string; reference: string },
  {
    superUser = false,
    answers = {},
  }: { superUser?: boolean; answers?: Answers } = {},
) {
  const console = openSignedIn(`/orders/${order.id}`, {
    ...(superUser ? { staff: RAVI } : {}),
    answers: { [ORDER(order)]: orderOf(order), ...answers },
  });
  await screen.findByRole('heading', {
    name: `Order ${order.reference}`,
    level: 1,
  });
  return console;
}

const card = (name: string) => screen.getByRole('region', { name });
const button = (name: string) => screen.getByRole('button', { name });
const dialog = () => screen.getByRole('dialog');

describe("an order's page", () => {
  it('opens from the list, and goes back to the list as it was', async () => {
    const { user, router } = openSignedIn('/orders?show=packed', {
      answers: {
        [ORDERS('?status=PACKED&sort=oldest')]: ordersOf([PACKED]),
        [ORDER(PACKED)]: orderOf(forAdmin(PACKED)),
      },
    });
    const list = await screen.findByRole('list', { name: 'Orders' });
    await user.click(
      within(list).getByRole('link', { name: `${PACKED.reference}, Asha K` }),
    );

    expect(
      await screen.findByRole('heading', { name: `Order ${PACKED.reference}` }),
    ).toBeInTheDocument();
    expect(document.title).toBe(
      `Order ${PACKED.reference} · Herbal Commerce Admin`,
    );
    // The way back, not the menu's link.
    await user.click(
      within(screen.getByRole('main')).getByRole('link', { name: 'Orders' }),
    );

    await waitFor(() =>
      expect(router.state.location.search).toBe('?show=packed'),
    );
  });

  it('shows what to pack, at the prices paid, and where it goes', async () => {
    await openOrder(forAdmin(PAID) as typeof PAID);

    const header = screen.getByRole('heading', { level: 1 }).closest('header');
    expect(header).toHaveTextContent('Placed 9 Nov 2026, 10:40');
    const items = card('Items');
    const [first, second] = within(items).getAllByRole('listitem');
    expect(first).toHaveTextContent('Ashwagandha Capsules · 60 capsules');
    expect(first).toHaveTextContent('ASH-CAP-60 · HSN 300490 · GST 5%');
    expect(first).toHaveTextContent('1 × ₹449');
    expect(second).toHaveTextContent('Amla Shampoo · 100 ml');
    expect(second).toHaveTextContent('2 × ₹240₹480');
    expect(items).toHaveTextContent('Items₹929');
    expect(items).toHaveTextContent('GST included in the prices₹94');
    expect(items).toHaveTextContent('DeliveryFree');
    expect(items).toHaveTextContent('Total₹929');

    const address = card('Deliver to');
    expect(address).toHaveTextContent(
      'Asha K12, 3rd Cross, IndiranagarBengaluru, Karnataka 560038',
    );
    expect(
      within(address).getByRole('link', { name: '9845012345' }),
    ).toHaveAttribute('href', 'tel:+919845012345');
  });

  it('shows an Admin no payment and no way to cancel', async () => {
    await openOrder(forAdmin(PAID) as typeof PAID);

    expect(screen.queryByRole('region', { name: 'Payment' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Cancel the order' }),
    ).toBeNull();
    expect(
      within(card('Steps'))
        .getAllByRole('listitem')
        .map(
          (step) =>
            step.firstElementChild?.nextElementSibling?.firstChild?.textContent,
        ),
    ).toEqual(['Placed', 'Packed', 'Shipped', 'Delivered']);
  });

  it('shows a Super User the payment, and when it was paid', async () => {
    await openOrder(PAID, { superUser: true });

    const payment = card('Payment');
    expect(payment).toHaveTextContent('Amount₹929');
    expect(payment).toHaveTextContent('Paid9 Nov 2026, 10:42');
    expect(payment).toHaveTextContent('pay_G3P9vcIhRs3NV4');
    expect(payment).toHaveTextContent('order_RB58MiP5SPFYyM');
    expect(card('Steps')).toHaveTextContent('Paid9 Nov 2026, 10:42');
    expect(button('Cancel the order')).toBeInTheDocument();
  });

  it('marks a paid order packed, and the lists and the count look again', async () => {
    const { user, api } = await openOrder(forAdmin(PAID) as typeof PAID, {
      answers: { [STEP(PAID, 'packed')]: orderOf(forAdmin(PACKED)) },
    });
    expect(
      screen.getByText(
        'Paid. Pack the items below, then mark it packed. The customer gets an email.',
      ),
    ).toBeInTheDocument();
    const counted = api.to('GET', TO_PACK.slice(4)).length;

    await user.click(button('Mark packed'));

    expect(
      await screen.findByText(`${PAID.reference} packed`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Packed. Hand it to the courier, then mark it shipped with the tracking number.',
      ),
    ).toBeInTheDocument();
    expect(card('Steps')).toHaveTextContent('Packed9 Nov 2026, 11:32');
    await waitFor(() =>
      expect(api.to('GET', TO_PACK.slice(4)).length).toBeGreaterThan(counted),
    );
    expect(api.to('POST', `/v1/staff/orders/${PAID.id}/packed`)).toHaveLength(
      1,
    );
  });

  it('says so when someone packed it meanwhile, and shows the order as it is', async () => {
    const { user, api } = await openOrder(forAdmin(PAID) as typeof PAID, {
      answers: {
        [ORDER(PAID)]: [orderOf(forAdmin(PAID)), orderOf(forAdmin(PACKED))],
        [STEP(PAID, 'packed')]: () =>
          json(409, { message: 'This order is packed already.' }),
      },
    });

    await user.click(button('Mark packed'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This order is packed already.',
    );
    await waitFor(() => expect(button('Mark shipped')).toBeInTheDocument());
    expect(api.to('GET', `/v1/staff/orders/${PAID.id}`)).toHaveLength(2);
  });

  it('ships a packed order with the courier and its tracking number, checked first', async () => {
    const { user, api } = await openOrder(forAdmin(PACKED) as typeof PAID, {
      answers: { [STEP(PACKED, 'shipped')]: orderOf(forAdmin(SHIPPED)) },
    });

    await user.click(button('Mark shipped'));
    const form = dialog();
    await user.click(
      within(form).getByRole('button', { name: 'Mark shipped' }),
    );
    expect(within(form).getByLabelText('Courier')).toHaveAccessibleDescription(
      /Name the courier in 2 to 60 characters/,
    );
    expect(
      within(form).getByLabelText('Tracking number'),
    ).toHaveAccessibleDescription(
      /A tracking number has 4 to 40 letters, digits or hyphens/,
    );
    expect(within(form).getByLabelText('Courier')).toHaveFocus();
    expect(api.to('POST', `/v1/staff/orders/${PACKED.id}/shipped`)).toEqual([]);

    await user.type(within(form).getByLabelText('Courier'), '  Delhivery ');
    await user.type(
      within(form).getByLabelText('Tracking number'),
      'ee 1490 8112 3456',
    );
    await user.click(
      within(form).getByRole('button', { name: 'Mark shipped' }),
    );

    expect(
      await screen.findByText(`${PACKED.reference} is on its way`),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      api.to('POST', `/v1/staff/orders/${PACKED.id}/shipped`)[0]?.body,
    ).toEqual({
      courierName: 'Delhivery',
      trackingNumber: 'EE149081123456',
    });
    expect(card('Steps')).toHaveTextContent('Delhivery · EE149081123456');
  });

  it('says so when someone shipped it meanwhile, and shows the order as it is', async () => {
    const { user, api } = await openOrder(forAdmin(PACKED) as typeof PAID, {
      answers: {
        [ORDER(PACKED)]: [
          orderOf(forAdmin(PACKED)),
          orderOf(forAdmin(SHIPPED)),
        ],
        [STEP(PACKED, 'shipped')]: () =>
          json(409, { message: 'This order has shipped already.' }),
      },
    });

    await user.click(button('Mark shipped'));
    const form = dialog();
    await user.type(within(form).getByLabelText('Courier'), 'Delhivery');
    await user.type(within(form).getByLabelText('Tracking number'), 'EE1490');
    await user.click(
      within(form).getByRole('button', { name: 'Mark shipped' }),
    );

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This order has shipped already.',
    );
    await waitFor(() =>
      expect(api.to('GET', `/v1/staff/orders/${PACKED.id}`)).toHaveLength(2),
    );
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByRole('button', { name: 'Mark delivered' }),
    ).toBeInTheDocument();
  });

  it('marks the field the API refused', async () => {
    const { user } = await openOrder(forAdmin(PACKED) as typeof PAID, {
      answers: {
        [STEP(PACKED, 'shipped')]: () =>
          json(400, {
            message: 'Validation failed',
            errors: [
              { field: 'trackingNumber', message: 'Check the tracking number' },
            ],
          }),
      },
    });

    await user.click(button('Mark shipped'));
    const form = dialog();
    await user.type(within(form).getByLabelText('Courier'), 'Delhivery');
    await user.type(within(form).getByLabelText('Tracking number'), 'EE1490');
    await user.click(
      within(form).getByRole('button', { name: 'Mark shipped' }),
    );

    await waitFor(() =>
      expect(
        within(form).getByLabelText('Tracking number'),
      ).toHaveAccessibleDescription(/Check the tracking number/),
    );
    expect(within(form).getByLabelText('Tracking number')).toHaveFocus();
  });

  it('corrects the tracking, sending only what changed', async () => {
    const corrected = { ...SHIPPED, trackingNumber: 'EE149081123457' };
    const { user, api } = await openOrder(forAdmin(SHIPPED) as typeof PAID, {
      answers: {
        [`PATCH /v1/staff/orders/${SHIPPED.id}/shipment`]: orderOf(
          forAdmin(corrected),
        ),
      },
    });

    await user.click(button('Correct the tracking'));
    let form = dialog();
    expect(within(form).getByLabelText('Courier')).toHaveValue('Delhivery');
    expect(within(form).getByLabelText('Tracking number')).toHaveValue(
      'EE149081123456',
    );
    // Nothing changed: nothing is sent.
    await user.click(
      within(form).getByRole('button', { name: 'Save changes' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(button('Correct the tracking'));
    form = dialog();
    await user.clear(within(form).getByLabelText('Tracking number'));
    await user.type(
      within(form).getByLabelText('Tracking number'),
      'ee149081123457',
    );
    await user.click(
      within(form).getByRole('button', { name: 'Save changes' }),
    );

    expect(
      await screen.findByText(`Tracking of ${SHIPPED.reference} corrected`),
    ).toBeInTheDocument();
    const sent = api.to('PATCH', `/v1/staff/orders/${SHIPPED.id}/shipment`);
    expect(sent.map((request) => request.body)).toEqual([
      { trackingNumber: 'EE149081123457' },
    ]);
  });

  it('asks before marking an order delivered, as the customer is told', async () => {
    const { user, api } = await openOrder(forAdmin(SHIPPED) as typeof PAID, {
      answers: { [STEP(SHIPPED, 'delivered')]: orderOf(forAdmin(DELIVERED)) },
    });

    await user.click(button('Mark delivered'));
    expect(dialog()).toHaveTextContent(
      'Only once Delhivery says it arrived. The customer gets an email saying so, and it can’t be undone.',
    );
    await user.click(within(dialog()).getByRole('button', { name: 'Not yet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.to('POST', `/v1/staff/orders/${SHIPPED.id}/delivered`)).toEqual(
      [],
    );

    await user.click(button('Mark delivered'));
    await user.click(
      within(dialog()).getByRole('button', { name: 'Mark delivered' }),
    );

    expect(
      await screen.findByText(
        'Delivered on 11 Nov 2026, 17:45. Nothing more to do.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).toBeNull();
  });

  it('lets a Super User cancel a packed order, saying all that follows', async () => {
    const { user, api } = await openOrder(PACKED, {
      superUser: true,
      answers: { [STEP(PACKED, 'cancel')]: orderOf(CANCELLED) },
    });

    await user.click(button('Cancel the order'));
    const box = dialog();
    expect(box).toHaveTextContent(
      'Its packs go back into stock at once. Unpack the box, and put them back on the shelf.',
    );
    expect(box).toHaveTextContent(
      'The customer gets ₹929 back in full, through Razorpay.',
    );
    expect(box).toHaveTextContent(
      'The customer gets an email saying it is cancelled.',
    );
    expect(box).toHaveTextContent('It can’t be undone.');
    await user.click(
      within(box).getByRole('button', { name: 'Keep the order' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.to('POST', `/v1/staff/orders/${PACKED.id}/cancel`)).toEqual([]);

    await user.click(button('Cancel the order'));
    await user.click(
      within(dialog()).getByRole('button', { name: 'Cancel the order' }),
    );

    expect(
      await screen.findByText(`${PACKED.reference} cancelled`),
    ).toBeInTheDocument();
    const refund = within(card('Payment')).getByRole('listitem');
    expect(refund).toHaveTextContent('₹929On its way back');
    expect(refund).toHaveTextContent('A Super User cancelled the order');
    expect(refund).toHaveTextContent(REFUND.razorpayRefundId ?? '');
    expect(
      screen.queryByRole('button', { name: 'Cancel the order' }),
    ).toBeNull();
  });

  it('says nothing was paid when cancelling an order that waits for payment', async () => {
    const { user } = await openOrder(WAITING, { superUser: true });

    expect(
      screen.getByText(
        'Waiting for the customer to pay. It holds its stock until 9 Nov 2026, 13:46, then expires if not paid.',
      ),
    ).toBeInTheDocument();
    expect(card('Payment')).toHaveTextContent('PaidNot paid yet');
    expect(card('Payment')).toHaveTextContent('Razorpay paymentNone yet');
    await user.click(button('Cancel the order'));

    expect(dialog()).toHaveTextContent(
      'Nothing has been paid. If a payment still comes, it goes back on its own.',
    );
    expect(dialog()).not.toHaveTextContent('Unpack the box');
  });

  it('offers no cancel once the order has shipped', async () => {
    await openOrder(SHIPPED, { superUser: true });

    expect(
      screen.queryByRole('button', { name: 'Cancel the order' }),
    ).toBeNull();
  });

  it('tells a Super User what to do about a refund that failed', async () => {
    const order = {
      ...CANCELLED,
      payment: { ...CANCELLED.payment, refunds: [FAILED_REFUND] },
    };
    await openOrder(order, { superUser: true });

    const refund = within(card('Payment')).getByRole('listitem');
    expect(refund).toHaveTextContent('Failed: give it back by hand');
    expect(refund).toHaveTextContent(
      'Give it back by hand in the Razorpay dashboard',
    );
  });

  it('prints a packing slip with what to pack and where, and no prices', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await openOrder(forAdmin(PAID) as typeof PAID);

    await user.click(button('Print packing slip'));

    expect(print).toHaveBeenCalledTimes(1);
    const slip = screen.getByRole('region', {
      name: 'Packing slip',
      hidden: true,
    });
    expect(slip).toHaveTextContent('Packing slip. Not a tax invoice.');
    expect(slip).toHaveTextContent(PAID.reference);
    expect(slip).toHaveTextContent('Asha K12, 3rd Cross, Indiranagar');
    expect(slip).toHaveTextContent('Amla Shampoo100 mlAML-SHA-1002');
    expect(slip).toHaveTextContent('Packs in all: 3');
    expect(slip).not.toHaveTextContent('₹');
  });

  it('offers no packing slip once the order has shipped', async () => {
    await openOrder(forAdmin(SHIPPED) as typeof PAID);

    expect(
      screen.queryByRole('button', { name: 'Print packing slip' }),
    ).toBeNull();
  });

  it('says when there is no such order', async () => {
    openSignedIn(`/orders/${PAID.id}`, {
      answers: {
        [ORDER(PAID)]: () => json(404, { message: 'Order not found' }),
      },
    });

    expect(
      await screen.findByText('There is no such order'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to the orders' }),
    ).toHaveAttribute('href', '/orders');
  });

  it('never sends an address that is not an ID', async () => {
    const { api } = openSignedIn('/orders/not-an-id');

    expect(
      await screen.findByText('There is no such order'),
    ).toBeInTheDocument();
    expect(
      api.sent.filter((request) => request.path.includes('not-an-id')),
    ).toEqual([]);
  });

  it('says when the order could not be loaded, and tries again', async () => {
    const { user } = openSignedIn(`/orders/${PAID.id}`, {
      answers: {
        [ORDER(PAID)]: [() => json(503, {}), orderOf(forAdmin(PAID))],
      },
    });

    expect(
      await screen.findByText('The order could not be loaded'),
    ).toBeInTheDocument();
    await user.click(button('Try again'));

    expect(
      await screen.findByRole('heading', { name: `Order ${PAID.reference}` }),
    ).toBeInTheDocument();
  });
});
