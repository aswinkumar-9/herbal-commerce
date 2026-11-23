import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { data, redirect } from 'react-router';
import { describe, expect, it } from 'vitest';
import { historyOf } from '../orders.server.ts';
import { checkoutFields } from '../razorpay.ts';
import type { Order } from '../orders.server.ts';
import { renderPage } from '../test/render.tsx';
import OrderPage from './order.tsx';

// Cancelling an order (part 14D), as drawn and read out.
const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const ORDER: Order = {
  id: ORDER_ID,
  reference: '7KQ2M9XDPA',
  status: 'PAID',
  holdExpiresAt: '2026-11-07T14:57:38.771Z',
  createdAt: '2026-11-07T14:42:38.771Z',
  packedAt: null,
  shippedAt: null,
  courierName: null,
  trackingNumber: null,
  deliveredAt: null,
  itemsTotalRupees: 449,
  itemsGstRupees: 21,
  deliveryChargeRupees: 49,
  totalRupees: 498,
  items: [
    {
      sku: 'ASH-CAP-60',
      productName: 'Ashwagandha Capsules',
      quantity: 60,
      unit: 'CAPSULES',
      packs: 1,
      mrpRupees: 500,
      priceRupees: 449,
      gstRate: 5,
      lineTotalRupees: 449,
      gstRupees: 21,
    },
  ],
  delivery: {
    fullName: 'Asha Verma',
    phone: '9845012345',
    line1: '12 MG Road',
    line2: null,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  },
  payment: { paidAt: '2026-11-07T14:45:00.000Z', refunds: [] },
};

// The page as the loader gives it; the order once cancelled, after the
// action redirects back with ?done=cancelled.
function openOrder({
  order = ORDER,
  canCancel = true,
  shipsWhenAsked = false,
  answer = async (intent: string) =>
    intent === 'cancel'
      ? { confirming: true, problem: null, wait: null }
      : redirect(`/orders/${ORDER_ID}?done=cancelled`),
}: {
  order?: Order;
  canCancel?: boolean;
  // The order ships while the customer is being asked.
  shipsWhenAsked?: boolean;
  answer?: (intent: string) => Promise<unknown>;
} = {}) {
  let cancelled = false;
  let shipped = false;
  renderPage({
    path: '/orders/:id',
    url: `/orders/${ORDER_ID}`,
    Component: OrderPage as never,
    loader: ({ request }) => {
      const done =
        new URL(request.url).searchParams.get('done') === 'cancelled';
      const now: Order = cancelled
        ? { ...order, status: 'CANCELLED' }
        : shipped
          ? { ...order, status: 'SHIPPED' }
          : order;
      return {
        order: now,
        history: historyOf(now),
        canCancel: canCancel && !cancelled && !shipped,
        done: done && cancelled,
        holdUntil: '8:27 pm',
        pay:
          now.status === 'PENDING_PAYMENT'
            ? {
                totalRupees: 498,
                fields: checkoutFields({
                  keyId: 'rzp_test_ABCDEFGHijkl01',
                  razorpayOrderId: 'order_RB58MiP5SPFYyM',
                  totalRupees: 498,
                  shopName: 'Herbal Commerce',
                  description: 'Order 7KQ2M9XDPA',
                  email: 'asha@example.com',
                  phone: '9845012345',
                  origin: 'https://shop.example.com',
                  orderId: ORDER_ID,
                }),
              }
            : null,
        payProblem: null,
        payWait: null,
        returned: null,
        origin: 'https://shop.example.com',
      };
    },
    action: async ({ request }) => {
      const intent = String((await request.formData()).get('intent'));
      const given = await answer(intent);
      if (given instanceof Response) {
        cancelled = true;
      }
      shipped = shipsWhenAsked;
      return given;
    },
  });
}

const section = () =>
  screen.findByRole('region', { name: 'Cancel this order' });

describe('the way to cancel', () => {
  it('a paid order: until it ships, with the payment back in full', async () => {
    openOrder();
    const shown = within(await section());
    expect(
      shown.getByText(
        'You can cancel it until it ships. Your ₹498 then comes back to you in full.',
      ),
    ).toBeInTheDocument();
    expect(shown.getByRole('button', { name: 'Cancel order' })).toBeEnabled();
  });

  it('a packed order too: until it ships, with the payment back in full', async () => {
    openOrder({ order: { ...ORDER, status: 'PACKED' } });
    expect(
      within(await section()).getByText(
        'You can cancel it until it ships. Your ₹498 then comes back to you in full.',
      ),
    ).toBeInTheDocument();
  });

  it('an order waiting for payment: its packs go back on sale', async () => {
    openOrder({
      order: { ...ORDER, status: 'PENDING_PAYMENT', payment: null },
    });
    expect(
      within(await section()).getByText(
        'Changed your mind? Cancel it, and its packs go back on sale.',
      ),
    ).toBeInTheDocument();
  });

  it('is not there once the order can’t be cancelled', async () => {
    openOrder({ order: { ...ORDER, status: 'SHIPPED' }, canCancel: false });
    await screen.findByRole('heading', { level: 1, name: 'Order 7KQ2M9XDPA' });
    expect(
      screen.queryByRole('region', { name: 'Cancel this order' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });
});

describe('asked once more', () => {
  it('“Cancel order” asks, the keyboard on the question, saying what it does, with the way to keep it', async () => {
    openOrder();
    await userEvent.click(
      within(await section()).getByRole('button', { name: 'Cancel order' }),
    );
    const question = await screen.findByRole('heading', {
      level: 2,
      name: 'Cancel order 7KQ2M9XDPA?',
    });
    await waitFor(() => expect(question).toHaveFocus());
    const asked = within(
      screen.getByRole('region', { name: 'Cancel order 7KQ2M9XDPA?' }),
    );
    expect(
      asked.getByText(
        'It will not be sent, and your ₹498 goes back to you in full.',
      ),
    ).toBeInTheDocument();
    expect(asked.getByRole('button', { name: 'Yes, cancel it' })).toBeEnabled();
    expect(asked.getByRole('link', { name: 'Keep the order' })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
    // Asked: the way to ask is gone until answered.
    expect(
      screen.queryByRole('region', { name: 'Cancel this order' }),
    ).toBeNull();
  });

  it('is not asked once the order has shipped in the meantime', async () => {
    openOrder({ shipsWhenAsked: true });
    await userEvent.click(
      within(await section()).getByRole('button', { name: 'Cancel order' }),
    );
    expect(
      await screen.findByText('On its way with the courier.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /\?$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Yes, cancel it' })).toBeNull();
  });

  it('for an order waiting for payment, says it can no longer be paid for, and Pay waits for the answer', async () => {
    openOrder({
      order: { ...ORDER, status: 'PENDING_PAYMENT', payment: null },
    });
    expect(
      await screen.findByRole('button', { name: 'Pay ₹498' }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(await section()).getByRole('button', { name: 'Cancel order' }),
    );
    expect(
      await screen.findByText(
        'It will not be sent, and it can no longer be paid for.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay ₹498' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'Keep the order' }));
    expect(
      await screen.findByRole('button', { name: 'Pay ₹498' }),
    ).toBeInTheDocument();
  });

  it('“Yes, cancel it” says so while on its way, a second press waits; then the order says it is cancelled, the keyboard on it', async () => {
    let finish: (value: unknown) => void = () => undefined;
    let asked = 0;
    openOrder({
      answer: (intent) => {
        if (intent === 'cancel') {
          return Promise.resolve({
            confirming: true,
            problem: null,
            wait: null,
          });
        }
        asked += 1;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    await userEvent.click(
      within(await section()).getByRole('button', { name: 'Cancel order' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Yes, cancel it' }),
    );
    const sending = await screen.findByRole('button', { name: 'Cancelling…' });
    expect(sending).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(sending);
    expect(asked).toBe(1);
    finish(redirect(`/orders/${ORDER_ID}?done=cancelled`));
    const said = await screen.findByText('Your order is cancelled.');
    await waitFor(() => expect(said).toHaveFocus());
    expect(screen.queryByRole('heading', { name: /\?$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it('refused, says why with the keyboard on it, and asks no more', async () => {
    openOrder({
      answer: async (intent) =>
        intent === 'cancel'
          ? { confirming: true, problem: null, wait: null }
          : data(
              { confirming: false, problem: 'late', wait: null },
              { status: 409 },
            ),
    });
    await userEvent.click(
      within(await section()).getByRole('button', { name: 'Cancel order' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Yes, cancel it' }),
    );
    const why = await screen.findByText(
      'This order can no longer be cancelled. It may have shipped a moment ago.',
    );
    await waitFor(() => expect(why.closest('[tabindex]')).toHaveFocus());
    expect(screen.queryByRole('heading', { name: /\?$/ })).toBeNull();
  });

  it('after too many tries, says how long to wait', async () => {
    openOrder({
      answer: async (intent) =>
        intent === 'cancel'
          ? { confirming: true, problem: null, wait: null }
          : data(
              {
                confirming: false,
                problem: 'resting',
                wait: 'Too many tries. Please wait 2 minutes and try again.',
              },
              { status: 429 },
            ),
    });
    await userEvent.click(
      within(await section()).getByRole('button', { name: 'Cancel order' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Yes, cancel it' }),
    );
    expect(
      await screen.findByText(
        'Too many tries. Please wait 2 minutes and try again.',
      ),
    ).toBeInTheDocument();
  });
});
