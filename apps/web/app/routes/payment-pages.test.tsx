import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Order } from '../orders.server.ts';
import { checkoutFields } from '../razorpay.ts';
import { renderPage } from '../test/render.tsx';
import OrderPage from './order.tsx';

// Paying for an order on Razorpay's own page, and what the order's page
// says when the customer is back (part 14C, ADR 0042), as drawn and read
// out.
const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const ORDER: Order = {
  id: ORDER_ID,
  reference: '7KQ2M9XDPA',
  status: 'PENDING_PAYMENT',
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
  payment: null,
};
const FIELDS = checkoutFields({
  keyId: 'rzp_test_ABCDEFGHijkl01',
  razorpayOrderId: 'order_RB58MiP5SPFYyM',
  totalRupees: 498,
  shopName: 'Herbal Commerce',
  description: 'Order 7KQ2M9XDPA',
  email: 'asha@example.com',
  phone: '9845012345',
  origin: 'https://shop.example.com',
  orderId: ORDER_ID,
});
const PAY = { totalRupees: 498, fields: FIELDS };

function openOrder(
  given: {
    order?: Order;
    pay?: typeof PAY | null;
    payProblem?: 'over' | 'changed' | 'resting' | null;
    payWait?: string | null;
    returned?: string | null;
  } = {},
) {
  renderPage({
    path: '/orders/:id',
    url: `/orders/${ORDER_ID}`,
    Component: OrderPage as never,
    loader: () => ({
      order: ORDER,
      holdUntil: '8:27 pm',
      pay: PAY,
      payProblem: null,
      payWait: null,
      returned: null,
      origin: 'https://shop.example.com',
      ...given,
    }),
  });
}

// jsdom can't leave the page: a form sent is stopped, after the page's own
// handler has seen it.
const sent: boolean[] = [];
const stop = (event: Event) => {
  sent.push(event.defaultPrevented);
  event.preventDefault();
};
afterEach(() => {
  window.removeEventListener('submit', stop);
  sent.length = 0;
});

describe('paying for an order', () => {
  it('is a plain form to Razorpay’s page, with the Razorpay order, the amount in paise and the way back', async () => {
    openOrder();
    const button = await screen.findByRole('button', { name: 'Pay ₹498' });
    const form = button.closest('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe(
      'https://api.razorpay.com/v1/checkout/embedded',
    );
    expect(
      Object.fromEntries(new FormData(form ?? undefined).entries()),
    ).toEqual({
      key_id: 'rzp_test_ABCDEFGHijkl01',
      order_id: 'order_RB58MiP5SPFYyM',
      amount: '49800',
      currency: 'INR',
      name: 'Herbal Commerce',
      description: 'Order 7KQ2M9XDPA',
      'prefill[email]': 'asha@example.com',
      'prefill[contact]': '+919845012345',
      callback_url: `https://shop.example.com/orders/${ORDER_ID}/payment`,
      cancel_url: `https://shop.example.com/orders/${ORDER_ID}?payment=cancelled`,
    });
    expect(
      screen.getByText(
        'Waiting for payment. Your packs are held until 8:27 pm.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You pay on Razorpay’s page, then come back here.'),
    ).toBeInTheDocument();
  });

  it('says it is on its way once pressed, and a second press waits; back from Razorpay’s page, it works again', async () => {
    const user = userEvent.setup();
    window.addEventListener('submit', stop);
    openOrder();
    await user.click(await screen.findByRole('button', { name: 'Pay ₹498' }));
    const leaving = screen.getByRole('button', { name: 'Opening Razorpay' });
    expect(leaving).toHaveAttribute('aria-disabled', 'true');
    await user.click(leaving);
    expect(sent).toEqual([false, true]);

    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      );
    });
    expect(
      await screen.findByRole('button', { name: 'Pay ₹498' }),
    ).not.toHaveAttribute('aria-disabled');
  });

  it('is not offered once the order is paid, and the order says so', async () => {
    openOrder({ order: { ...ORDER, status: 'PAID' }, pay: null });
    expect(
      await screen.findByText('Paid. We will pack it next.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
  });

  it('when the time to pay is over, says so instead of the hold, and leads to the shop', async () => {
    openOrder({ pay: null, payProblem: 'over', returned: null });
    expect(
      await screen.findByText(
        'The time to pay for this order is over, so its packs are going back on sale. You can order them again.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/held until/)).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Go to the shop' }),
    ).toHaveAttribute('href', '/shop');
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
  });

  it('when payments can’t be started now, says so, with the wait when the API gave one', async () => {
    openOrder({ pay: null, payProblem: 'resting' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Payments are not available right now. Please try again in a minute.',
    );
  });

  it('says how long to wait after too many tries', async () => {
    openOrder({
      pay: null,
      payProblem: 'resting',
      payWait: 'Too many tries. Please wait 5 minutes and try again.',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many tries. Please wait 5 minutes and try again.',
    );
  });
});

describe('back from Razorpay’s page', () => {
  it('says a payment that did not go through, with the keyboard on it, and the way to pay again', async () => {
    openOrder({ returned: 'failed' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The payment did not go through. You can try again below.',
    );
    await waitFor(() => {
      expect(alert).toHaveFocus();
    });
    expect(
      screen.getByRole('button', { name: 'Pay ₹498' }),
    ).toBeInTheDocument();
  });

  it('says a payment Razorpay has not confirmed yet, calmly, as a status', async () => {
    openOrder({ returned: 'checking' });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(
      'Razorpay has not confirmed your payment yet. Look at this page again in a minute, before paying again.',
    );
    await waitFor(() => {
      expect(status).toHaveFocus();
    });
  });

  it('says the customer left Razorpay’s page before paying', async () => {
    openOrder({ returned: 'cancelled' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You left Razorpay’s page before paying. You can pay below.',
    );
  });

  it('says a payment that could not be verified', async () => {
    openOrder({ returned: 'unverified' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not verify that payment. If it went through, this page will show it once Razorpay tells us.',
    );
  });
});

describe('money going back', () => {
  const refund = (
    reason: string,
    status: string,
    givenBackAt: string | null = null,
  ) => ({
    amountRupees: 498,
    reason,
    status,
    createdAt: '2026-11-07T15:10:00.000Z',
    givenBackAt,
  });

  it('says why and where it stands, for each payment going back', async () => {
    openOrder({
      order: {
        ...ORDER,
        status: 'EXPIRED',
        payment: {
          paidAt: null,
          refunds: [
            refund('ORDER_EXPIRED', 'PENDING'),
            refund('ALREADY_PAID', 'PROCESSED'),
            refund('ORDER_CANCELLED', 'FAILED'),
            refund('CANCELLED_BY_STAFF', 'FAILED', '2026-11-08T10:00:00.000Z'),
            refund('SOMETHING_NEW', 'REQUESTED'),
          ],
        },
      },
      pay: null,
    });
    const section = await screen.findByRole('region', {
      name: 'Money going back',
    });
    const lines = [...section.querySelectorAll('li')].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      'Your payment came after the time to pay was over, when there was no longer enough stock. ₹498 is on its way back to you.',
      'This order was paid twice, so the second payment goes back. ₹498 is back with you.',
      'Your payment came after the order was cancelled. ₹498 could not be given back by itself. Our team has been told, and gives it back by hand.',
      'We cancelled the order. ₹498 is back with you.',
      '₹498 is on its way back to you.',
    ]);
  });

  it('is not shown when nothing goes back', async () => {
    openOrder();
    await screen.findByRole('button', { name: 'Pay ₹498' });
    expect(
      screen.queryByRole('region', { name: 'Money going back' }),
    ).toBeNull();
  });
});
