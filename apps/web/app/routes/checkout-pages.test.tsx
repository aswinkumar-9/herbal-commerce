import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Address } from '../address.ts';
import type { Cart } from '../cart.server.ts';
import { historyOf } from '../orders.server.ts';
import type { Checkout, Order } from '../orders.server.ts';
import { renderPage } from '../test/render.tsx';
import CartPage from './cart.tsx';
import CheckoutPage from './checkout.tsx';
import OrderPage from './order.tsx';

// Checkout, an order's page and the cart's way to checkout, as they are
// drawn and read out (part 14C, ADR 0042).
const HOME_ID = '0b6f3c1e-8f3a-4c55-9a51-3c2b1d7e9f10';
const OFFICE_ID = '7d0c2b4a-1e2f-4a3b-8c9d-0e1f2a3b4c5d';
const KEY = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const address = (id: string, line1: string, isDefault: boolean): Address => ({
  id,
  fullName: 'Asha Verma',
  phone: '9845012345',
  line1,
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  isDefault,
});
const ADDRESSES = [
  address(HOME_ID, '12 MG Road', true),
  address(OFFICE_ID, '4 Residency Road', false),
];
const LINE = {
  sku: 'ASH-CAP-60',
  productName: 'Ashwagandha Capsules',
  quantity: 60,
  unit: 'CAPSULES' as const,
  packs: 2,
  mrpRupees: 500,
  priceRupees: 449,
  gstRate: 5,
  lineTotalRupees: 898,
  gstRupees: 43,
};
const CHECKOUT: Checkout = {
  items: [LINE],
  itemsTotalRupees: 898,
  itemsGstRupees: 43,
  deliveryChargeRupees: 0,
  totalRupees: 898,
};

function openCheckout({
  checkout = CHECKOUT,
  problem = null,
  addresses = ADDRESSES,
  chosen = HOME_ID,
  answer = null,
}: {
  checkout?: Checkout | null;
  problem?: string | null;
  addresses?: Address[];
  chosen?: string | null;
  answer?: unknown;
} = {}) {
  const sentForms: FormData[] = [];
  renderPage({
    path: '/checkout',
    Component: CheckoutPage as never,
    loader: () => ({
      checkout,
      problem,
      addresses,
      chosen,
      key: KEY,
      origin: 'https://shop.example.com',
    }),
    action: async ({ request }) => {
      sentForms.push(await request.formData());
      return answer;
    },
  });
  return { sentForms, user: userEvent.setup() };
}

describe('the checkout page', () => {
  it('offers the saved addresses, the default chosen, each read out by who and where', async () => {
    openCheckout();
    const where = await screen.findByRole('group', {
      name: 'Delivery address',
    });
    const home = within(where).getByRole('radio', {
      name: 'Asha Verma, 12 MG Road',
    });
    expect(home).toBeChecked();
    expect(home).toHaveAccessibleDescription(
      'Bengaluru, Karnataka 560001. Phone 98450 12345',
    );
    expect(
      within(where).getByRole('radio', {
        name: 'Asha Verma, 4 Residency Road',
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('link', { name: 'Add an address' }),
    ).toHaveAttribute('href', '/account/addresses/new?then=checkout');
  });

  it('shows the order as the API priced it, free delivery said so, and GST inside', async () => {
    openCheckout();
    const order = await screen.findByRole('region', { name: 'Your order' });
    expect(order).toHaveTextContent('Ashwagandha Capsules, 60 capsules');
    expect(order).toHaveTextContent('2 packs at ₹449 each');
    expect(order).toHaveTextContent('Items₹898');
    expect(order).toHaveTextContent('DeliveryFree');
    expect(order).toHaveTextContent('Total₹898');
    expect(order).toHaveTextContent(
      'Prices include GST: ₹43 of the items is GST.',
    );
    expect(
      screen.getByText(
        'Placing it holds your packs for 15 minutes while you pay.',
      ),
    ).toBeInTheDocument();
  });

  it('sends the chosen address, the total shown and the key with one button', async () => {
    const { sentForms, user } = openCheckout();
    await user.click(
      await screen.findByRole('radio', {
        name: 'Asha Verma, 4 Residency Road',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(sentForms).toHaveLength(1));
    expect(Object.fromEntries(sentForms[0] ?? [])).toEqual({
      intent: 'place',
      key: KEY,
      total: '898',
      addressId: OFFICE_ID,
    });
  });

  it('with no address saved, asks for one, and offers no button to place', async () => {
    openCheckout({ addresses: [], chosen: null });
    expect(
      await screen.findByText(
        'Add a delivery address, and your order can go there.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Place order' })).toBeNull();
  });

  it('when the cart can’t be ordered, says why, with the way back to the cart, and no form', async () => {
    openCheckout({ checkout: null, problem: 'unavailable' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Some packs in your cart can’t be ordered now. Change or remove them in your cart first.',
    );
    expect(
      within(alert).getByRole('link', { name: 'Back to your cart' }),
    ).toHaveAttribute('href', '/cart');
    expect(screen.queryByRole('button', { name: 'Place order' })).toBeNull();
  });

  it('with 3 orders waiting for payment, says to pay for or cancel one, with the way to the orders (part 14D)', async () => {
    const { user } = openCheckout({
      answer: { problem: 'tooMany', wait: null, key: null },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Place order' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'You have 3 orders waiting for payment. Pay for one or cancel it first, or wait: an order not paid within 15 minutes ends by itself.',
    );
    expect(
      within(alert).getByRole('link', { name: 'See your orders' }),
    ).toHaveAttribute('href', '/orders');
    expect(
      within(alert).queryByRole('link', { name: 'Back to your cart' }),
    ).toBeNull();
  });

  it('when refused, says why and the keyboard goes there; not knowing if it went, sends the same key again', async () => {
    const { user } = openCheckout({
      answer: { problem: 'resting', wait: null, key: 'a-key-to-send-again' },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Place order' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'We could not place your order just now. Please try again in a minute.',
    );
    await waitFor(() => expect(alert).toHaveFocus());
    expect(
      document.querySelector<HTMLInputElement>('input[name=key]')?.value,
    ).toBe('a-key-to-send-again');
  });
});

const ORDER: Order = {
  id: '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30',
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
  items: [{ ...LINE, packs: 1, lineTotalRupees: 449, gstRupees: 21 }],
  delivery: {
    fullName: 'Asha Verma',
    phone: '9845012345',
    line1: '12 MG Road',
    line2: 'Near the clock tower',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  },
  payment: null,
};

function openOrder(order: Order = ORDER) {
  renderPage({
    path: '/orders/:id',
    url: `/orders/${order.id}`,
    Component: OrderPage as never,
    loader: () => ({
      order,
      history: historyOf(order),
      holdUntil: '8:27 pm',
      origin: 'https://shop.example.com',
    }),
  });
}

describe('an order’s page', () => {
  it('names the order by its reference, says where it stands, what was ordered and where it goes', async () => {
    openOrder();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Order 7KQ2M9XDPA',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Waiting for payment. Your packs are held until 8:27 pm.',
      ),
    ).toBeInTheDocument();
    const items = screen.getByRole('region', { name: 'What you ordered' });
    expect(items).toHaveTextContent('Delivery₹49');
    expect(items).toHaveTextContent('Total₹498');
    expect(
      screen.getByRole('region', { name: 'Delivering to' }),
    ).toHaveTextContent(
      'Asha Verma12 MG RoadNear the clock towerBengaluru, Karnataka 560001Phone 98450 12345',
    );
  });

  it('says each later step in plain words', async () => {
    openOrder({ ...ORDER, status: 'EXPIRED' });
    expect(
      await screen.findByText(
        'Not paid in time, so it was not sent. Its packs went back on sale.',
      ),
    ).toBeInTheDocument();
  });
});

describe('the cart’s way to checkout', () => {
  const line = (status: Cart['items'][number]['status']) => ({
    product: {
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
      imageUrl: null,
    },
    sku: `ASH-CAP-${status}`,
    quantity: 60,
    unit: 'CAPSULES' as const,
    mrpRupees: 500,
    priceRupees: 449,
    packs: 1,
    lineTotalRupees: 449,
    status,
  });
  const openCart = (items: Cart['items']) =>
    renderPage({
      path: '/cart',
      Component: CartPage as never,
      loader: () => ({
        cart: {
          items,
          packs: 1,
          subtotalRupees: 449,
          mrpTotalRupees: 500,
        },
        origin: 'https://shop.example.com',
      }),
    });

  it('is there when every line can be bought', async () => {
    openCart([line('AVAILABLE')]);
    expect(
      await screen.findByRole('link', { name: 'Go to checkout' }),
    ).toHaveAttribute('href', '/checkout');
  });

  it('asks to remove what can’t be bought first: the API orders the whole cart', async () => {
    openCart([line('AVAILABLE'), line('OFF_SALE')]);
    expect(
      await screen.findByText(
        'Remove the packs that can’t be bought now, and you can check out.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Go to checkout' })).toBeNull();
  });
});
