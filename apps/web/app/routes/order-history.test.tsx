import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyOf } from '../orders.server.ts';
import type { Order } from '../orders.server.ts';
import { renderPage } from '../test/render.tsx';
import OrderPage from './order.tsx';

// An order's history, and the courier with the tracking number once it has
// shipped (part 14D), as worked out and as drawn.
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
const PAID = '2026-11-07T14:45:00.000Z';
const PACKED = '2026-11-08T05:30:00.000Z';
const SHIPPED = '2026-11-08T11:05:00.000Z';
const DELIVERED = '2026-11-10T09:20:00.000Z';
const paid = { paidAt: PAID, refunds: [] };
const SHIPPED_ORDER: Order = {
  ...ORDER,
  status: 'SHIPPED',
  payment: paid,
  packedAt: PACKED,
  shippedAt: SHIPPED,
  courierName: 'Blue Courier',
  trackingNumber: 'BC1234567890',
};

// Each step as [name, done, when].
const steps = (order: Order) =>
  historyOf(order).map(({ step, done, when }) => [step, done, when]);

describe('an order’s history, worked out', () => {
  it('waiting for payment: placed, with when, in India; the rest still to come', () => {
    expect(steps(ORDER)).toEqual([
      ['placed', true, '7 Nov 2026, 8:12 pm'],
      ['paid', false, null],
      ['packed', false, null],
      ['shipped', false, null],
      ['delivered', false, null],
    ]);
    expect(historyOf(ORDER)[0]?.at).toBe(ORDER.createdAt);
  });

  it('shipped: each step so far with its time, delivery still to come', () => {
    expect(steps(SHIPPED_ORDER)).toEqual([
      ['placed', true, '7 Nov 2026, 8:12 pm'],
      ['paid', true, '7 Nov 2026, 8:15 pm'],
      ['packed', true, '8 Nov 2026, 11:00 am'],
      ['shipped', true, '8 Nov 2026, 4:35 pm'],
      ['delivered', false, null],
    ]);
    expect(
      steps({ ...SHIPPED_ORDER, status: 'DELIVERED', deliveredAt: DELIVERED }),
    ).toContainEqual(['delivered', true, '10 Nov 2026, 2:50 pm']);
  });

  it('a step the order is past counts as done, even without its time', () => {
    expect(steps({ ...ORDER, status: 'PAID' }).slice(1, 3)).toEqual([
      ['paid', true, null],
      ['packed', false, null],
    ]);
    expect(steps({ ...ORDER, status: 'PACKED' })).toEqual([
      ['placed', true, '7 Nov 2026, 8:12 pm'],
      ['paid', true, null],
      ['packed', true, null],
      ['shipped', false, null],
      ['delivered', false, null],
    ]);
  });

  it('cancelled: the steps it took, then “cancelled”, which has no time', () => {
    expect(
      steps({ ...ORDER, status: 'CANCELLED', payment: paid, packedAt: PACKED }),
    ).toEqual([
      ['placed', true, '7 Nov 2026, 8:12 pm'],
      ['paid', true, '7 Nov 2026, 8:15 pm'],
      ['packed', true, '8 Nov 2026, 11:00 am'],
      ['cancelled', true, null],
    ]);
    expect(steps({ ...ORDER, status: 'CANCELLED' })).toEqual([
      ['placed', true, '7 Nov 2026, 8:12 pm'],
      ['cancelled', true, null],
    ]);
  });

  it('not paid in time: placed, then when its time to pay ended', () => {
    expect(steps({ ...ORDER, status: 'EXPIRED' })).toEqual([
      ['placed', true, '7 Nov 2026, 8:12 pm'],
      ['expired', true, '7 Nov 2026, 8:27 pm'],
    ]);
  });
});

function openOrder(order: Order) {
  renderPage({
    path: '/orders/:id',
    url: `/orders/${ORDER_ID}`,
    Component: OrderPage as never,
    loader: () => ({
      order,
      history: historyOf(order),
      holdUntil: '8:27 pm',
      pay: null,
      payProblem: null,
      payWait: null,
      returned: null,
      origin: 'https://shop.example.com',
    }),
  });
}

const history = async () =>
  within(await screen.findByRole('region', { name: 'History' }));
const readOut = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent);

// The browser's clipboard, as the test wants it.
function clipboard(writeText: (() => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText: vi.fn(writeText) } : undefined,
  });
  return navigator.clipboard as unknown as {
    writeText: ReturnType<typeof vi.fn>;
  };
}
afterEach(() => {
  clipboard(undefined);
});

describe('an order’s history, drawn', () => {
  it('lists the steps in order, each done one with when, the rest “not yet”', async () => {
    openOrder(ORDER);
    const list = (await history()).getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(readOut(list)).toEqual([
      'Placed7 Nov 2026, 8:12 pm',
      'PaidNot yet',
      'PackedNot yet',
      'ShippedNot yet',
      'DeliveredNot yet',
    ]);
    expect(list.querySelector('time')).toHaveAttribute(
      'datetime',
      ORDER.createdAt,
    );
  });

  it('a cancelled order ends with “Cancelled”, with no time', async () => {
    openOrder({ ...ORDER, status: 'CANCELLED' });
    expect(readOut((await history()).getByRole('list'))).toEqual([
      'Placed7 Nov 2026, 8:12 pm',
      'Cancelled',
    ]);
  });

  it('once shipped, names the courier and the tracking number, and how to use it', async () => {
    clipboard(undefined);
    openOrder(SHIPPED_ORDER);
    const shown = await history();
    expect(shown.getByText('Courier').nextElementSibling).toHaveTextContent(
      'Blue Courier',
    );
    expect(
      shown.getByText('Tracking number').nextElementSibling,
    ).toHaveTextContent('BC1234567890');
    expect(
      shown.getByText('Use it on the courier’s website to follow your parcel.'),
    ).toBeInTheDocument();
    // Without a clipboard to write to, no button that can't work.
    expect(shown.queryByRole('button')).toBeNull();
  });

  it('copies the tracking number, says so, and is ready again a moment later', async () => {
    const written = clipboard(() => Promise.resolve());
    openOrder(SHIPPED_ORDER);
    const copy = (await history()).getByRole('button', {
      name: 'Copy tracking number',
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => {
        fireEvent.click(copy);
      });
      expect(written.writeText).toHaveBeenCalledWith('BC1234567890');
      expect(copy).toHaveAccessibleName('Copied tracking number');
      expect(screen.getByRole('status')).toHaveTextContent(
        'Tracking number copied.',
      );
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(copy).toHaveAccessibleName('Copy tracking number');
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it('when the browser won’t copy, says to select it instead', async () => {
    clipboard(() => Promise.reject(new Error('denied')));
    openOrder(SHIPPED_ORDER);
    const copy = (await history()).getByRole('button', {
      name: 'Copy tracking number',
    });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Could not copy it. Select the number to copy it yourself.',
    );
  });

  it('shows no courier before the order has shipped', async () => {
    openOrder({ ...ORDER, status: 'PAID', payment: paid });
    const shown = await history();
    expect(shown.queryByText('Courier')).toBeNull();
    expect(shown.queryByText('Tracking number')).toBeNull();
  });
});
