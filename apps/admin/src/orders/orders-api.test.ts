import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import { fakeApi, json } from '../test/fake-api';
import {
  CANCELLED,
  FAILED_REFUND,
  ORDER,
  ORDERS,
  PAID,
  PAID_LATER,
  REFUND,
  REFUNDS,
  SHIPPED,
  STEP,
  TO_PACK,
  forAdmin,
  orderOf,
  ordersOf,
  listed,
  refundsOf,
  summaryOf,
} from '../test/order-fixtures';
import {
  cancelOrder,
  correctShipment,
  countToPack,
  getOrder,
  listOrders,
  listRefunds,
  markDelivered,
  markPacked,
  markShipped,
  orderReference,
} from './orders-api';

const NOT_UNDERSTOOD =
  'The server sent an answer the console does not understand.';

function signedIn() {
  setAccessToken('t1');
}

describe('the orders list', () => {
  it('asks for a page with only the filters given', async () => {
    signedIn();
    const api = fakeApi({
      [ORDERS()]: ordersOf([PAID_LATER, PAID], PAID.id),
      [ORDERS(
        `?status=PAID&reference=7KQ2M9XDPA&sort=oldest&after=${PAID.id}&limit=25`,
      )]: ordersOf([]),
    });

    await expect(listOrders({})).resolves.toEqual({
      orders: [summaryOf(PAID_LATER), summaryOf(PAID)],
      nextAfter: PAID.id,
    });
    await expect(
      listOrders({
        status: 'PAID',
        reference: '7KQ2M9XDPA',
        sort: 'oldest',
        after: PAID.id,
        limit: 25,
      }),
    ).resolves.toEqual({ orders: [], nextAfter: null });
    expect(api.unexpected).toEqual([]);
    expect(api.sent.every((r) => r.authorization === 'Bearer t1')).toBe(true);
  });

  it('counts the orders to pack, up to 100', async () => {
    signedIn();
    fakeApi({
      [TO_PACK]: [ordersOf([PAID, PAID_LATER]), ordersOf([PAID], PAID.id)],
    });

    await expect(countToPack()).resolves.toEqual({ count: 2, more: false });
    await expect(countToPack()).resolves.toEqual({ count: 1, more: true });
  });

  it.each([
    ['a status it does not know', { status: 'LOST' }],
    ['paise', { totalRupees: 498.5 }],
    ['a time that is not one', { createdAt: '9 Nov 2026' }],
  ])('refuses %s', async (_, change) => {
    signedIn();
    fakeApi({
      [ORDERS()]: () =>
        json(200, {
          orders: [{ ...summaryOf(PAID), ...change }],
          nextAfter: null,
        }),
    });

    await expect(listOrders({})).rejects.toThrow(NOT_UNDERSTOOD);
  });
});

describe('an order', () => {
  it('reads one with its payment for a Super User, and without for an Admin', async () => {
    signedIn();
    fakeApi({
      [ORDER(PAID)]: [orderOf(PAID), orderOf(forAdmin(PAID))],
    });

    await expect(getOrder(PAID.id)).resolves.toEqual(PAID);
    const seen = await getOrder(PAID.id);
    expect(seen).toEqual(forAdmin(PAID));
    expect('payment' in seen).toBe(false);
  });

  it('reads a cancelled one with its refund', async () => {
    signedIn();
    fakeApi({ [ORDER(CANCELLED)]: orderOf(CANCELLED) });

    await expect(getOrder(CANCELLED.id)).resolves.toMatchObject({
      status: 'CANCELLED',
      payment: { refunds: [REFUND] },
    });
  });

  it('sends nothing for an ID that is not one', async () => {
    signedIn();
    const api = fakeApi({});

    await expect(getOrder('../refunds')).rejects.toEqual(
      new ApiError(404, 'There is no such item.'),
    );
    expect(api.sent).toEqual([]);
  });

  it.each([
    ['a line in paise', { items: [{ ...PAID.items[0], priceRupees: 448.5 }] }],
    [
      'a unit it does not know',
      { items: [{ ...PAID.items[0], unit: 'BOTTLES' }] },
    ],
    ['no lines', { items: [] }],
    ['no packs', { items: [{ ...PAID.items[0], packs: 0 }] }],
    [
      'a delivery without its pincode',
      { delivery: { ...PAID.delivery, pincode: undefined } },
    ],
    [
      'a refund status it does not know',
      {
        payment: { ...PAID.payment, refunds: [{ ...REFUND, status: 'LOST' }] },
      },
    ],
  ])('refuses %s', async (_, change) => {
    signedIn();
    fakeApi({ [ORDER(PAID)]: orderOf({ ...PAID, ...change }) });

    await expect(getOrder(PAID.id)).rejects.toThrow(NOT_UNDERSTOOD);
  });
});

describe('the steps', () => {
  it('packs, ships, corrects, delivers and cancels, each at its own address', async () => {
    signedIn();
    const api = fakeApi({
      [STEP(PAID, 'packed')]: orderOf({ ...PAID, status: 'PACKED' }),
      [STEP(PAID, 'shipped')]: orderOf(SHIPPED),
      [`PATCH /v1/staff/orders/${PAID.id}/shipment`]: orderOf({
        ...SHIPPED,
        trackingNumber: 'EE149081123457',
      }),
      [STEP(PAID, 'delivered')]: orderOf({ ...SHIPPED, status: 'DELIVERED' }),
      [STEP(PAID, 'cancel')]: orderOf(CANCELLED),
    });

    await expect(markPacked(PAID.id)).resolves.toMatchObject({
      status: 'PACKED',
    });
    await expect(
      markShipped(PAID.id, {
        courierName: 'Delhivery',
        trackingNumber: 'ee 1490 8112 3456',
      }),
    ).resolves.toEqual(SHIPPED);
    await expect(
      correctShipment(PAID.id, { trackingNumber: 'EE149081123457' }),
    ).resolves.toMatchObject({ trackingNumber: 'EE149081123457' });
    await expect(markDelivered(PAID.id)).resolves.toMatchObject({
      status: 'DELIVERED',
    });
    await expect(cancelOrder(PAID.id)).resolves.toMatchObject({
      status: 'CANCELLED',
    });

    expect(api.sent.map((r) => [r.method, r.body])).toEqual([
      ['POST', undefined],
      [
        'POST',
        { courierName: 'Delhivery', trackingNumber: 'ee 1490 8112 3456' },
      ],
      ['PATCH', { trackingNumber: 'EE149081123457' }],
      ['POST', undefined],
      ['POST', undefined],
    ]);
    expect(api.unexpected).toEqual([]);
  });

  it('passes on the API’s refusal of a step taken already', async () => {
    signedIn();
    fakeApi({
      [STEP(PAID, 'packed')]: () =>
        json(409, { message: 'This order is packed already.' }),
    });

    await expect(markPacked(PAID.id)).rejects.toEqual(
      new ApiError(409, 'This order is packed already.'),
    );
  });
});

describe('the refunds', () => {
  it('lists them a page at a time, each naming its order', async () => {
    signedIn();
    const failed = listed(FAILED_REFUND, PAID_LATER);
    const pending = listed(REFUND, PAID);
    const api = fakeApi({
      [REFUNDS()]: refundsOf([failed, pending], REFUND.id),
      [REFUNDS(`?status=FAILED&after=${REFUND.id}&limit=20`)]: refundsOf([]),
    });

    await expect(listRefunds({})).resolves.toEqual({
      refunds: [failed, pending],
      nextAfter: REFUND.id,
    });
    await expect(
      listRefunds({ status: 'FAILED', after: REFUND.id, limit: 20 }),
    ).resolves.toEqual({ refunds: [], nextAfter: null });
    expect(api.unexpected).toEqual([]);
  });

  it.each([
    ['a reason it does not know', { reason: 'CHANGED_MIND' }],
    ['no order', { orderId: undefined }],
    ["no order's reference", { orderReference: undefined }],
  ])('refuses %s', async (_, change) => {
    signedIn();
    fakeApi({
      [REFUNDS()]: () =>
        json(200, {
          refunds: [{ ...listed(REFUND, PAID), ...change }],
          nextAfter: null,
        }),
    });

    await expect(listRefunds({})).rejects.toThrow(NOT_UNDERSTOOD);
  });
});

describe('a reference staff type', () => {
  it.each([
    ['7KQ2M9XDPA', '7KQ2M9XDPA'],
    [' 7kq2m9xdpa ', '7KQ2M9XDPA'],
    ['7KQ2 M9XD-PA', '7KQ2M9XDPA'],
  ])('reads %j as %s', (typed, reference) => {
    expect(orderReference(typed)).toBe(reference);
  });

  it.each(['', '7KQ2M9XDP', '7KQ2M9XDPAA', '7KQ2M9XD#A', 'Asha K'])(
    'refuses %j',
    (typed) => {
      expect(orderReference(typed)).toBeUndefined();
    },
  );
});
