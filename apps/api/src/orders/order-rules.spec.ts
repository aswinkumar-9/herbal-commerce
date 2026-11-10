import {
  CANCELLABLE,
  CART_EMPTY,
  DELIVERY_CHARGE_RUPEES,
  deliveryChargeRupees,
  FREE_DELIVERY_FROM_RUPEES,
  gstInsideRupees,
  HOLD_MINUTES,
  HOLD_OVER,
  holdExpiresAt,
  lineAmounts,
  MAX_OPEN_ORDERS,
  newOrderReference,
  NOT_CANCELLABLE,
  NOT_ON_ITS_WAY,
  NOT_PAYABLE,
  notEnoughStock,
  notReady,
  ORDER_REFERENCE,
  ORDER_STEPS,
  orderTotals,
  PAYMENT_NOT_STARTED,
  PAYMENT_NOT_VERIFIED,
  PAYMENTS_UNAVAILABLE,
  REFERENCE_LENGTH,
  TOO_MANY_OPEN,
  TOTAL_CHANGED,
} from './order-rules';

describe("the owner's numbers", () => {
  it('hold stock 15 minutes, and deliver free from Rs 499, else for Rs 49', () => {
    expect(HOLD_MINUTES).toBe(15);
    expect(FREE_DELIVERY_FROM_RUPEES).toBe(499);
    expect(DELIVERY_CHARGE_RUPEES).toBe(49);
  });

  it('let a customer have at most 3 orders waiting for payment', () => {
    expect(MAX_OPEN_ORDERS).toBe(3);
  });

  it('are explained in the messages', () => {
    expect(CART_EMPTY).toBe('The cart is empty.');
    expect(NOT_CANCELLABLE).toBe('This order can no longer be cancelled.');
    expect(CANCELLABLE).toEqual(['PENDING_PAYMENT', 'PAID', 'PACKED']);
    expect(TOO_MANY_OPEN).toBe(
      'You have 3 orders waiting for payment. Pay for one or cancel it first.',
    );
    expect(TOTAL_CHANGED).toBe(
      'The total has changed. Check the cart and try again.',
    );
    expect(NOT_PAYABLE).toBe('Only an order waiting for payment can be paid.');
    expect(HOLD_OVER).toBe(
      'The time to pay for this order is over. Please order again.',
    );
    expect(PAYMENTS_UNAVAILABLE).toBe(
      'Payments are not available right now. Please try again in a minute.',
    );
    expect(PAYMENT_NOT_STARTED).toBe('Start paying for this order first.');
    expect(PAYMENT_NOT_VERIFIED).toBe('The payment could not be verified.');
    expect(ORDER_STEPS).toEqual({
      PACKED: {
        from: 'PAID',
        notReady: 'Only a paid order can be packed.',
        done: 'This order is packed already.',
      },
      SHIPPED: {
        from: 'PACKED',
        notReady: 'Only a packed order can be shipped.',
        done: 'This order has shipped already.',
      },
      DELIVERED: {
        from: 'SHIPPED',
        notReady: 'Only a shipped order can be marked delivered.',
        done: 'This order is delivered already.',
      },
    });
    expect(NOT_ON_ITS_WAY).toBe(
      'Only an order on its way can have its courier or tracking number corrected.',
    );
    expect(notReady(['ASH-CAP-60', 'TULSI-100'])).toBe(
      "These packs can't be ordered now: ASH-CAP-60, TULSI-100. Change or remove them first.",
    );
    expect(notEnoughStock('ASH-CAP-60')).toBe(
      'ASH-CAP-60 is out of stock, or not enough of it is left. Change it in the cart and try again.',
    );
  });
});

describe('deliveryChargeRupees', () => {
  it('is Rs 49 below Rs 499, and free from Rs 499', () => {
    expect(deliveryChargeRupees(1)).toBe(49);
    expect(deliveryChargeRupees(498)).toBe(49);
    expect(deliveryChargeRupees(499)).toBe(0);
    expect(deliveryChargeRupees(2_500)).toBe(0);
  });
});

describe('gstInsideRupees', () => {
  it('finds the GST inside a price that includes it, rounded to the nearest rupee', () => {
    // Rs 449 at 5%: Rs 21.38, so Rs 21.
    expect(gstInsideRupees(449, 5)).toBe(21);
    // Rs 11 at 5%: Rs 0.52, rounded up to Rs 1. Rs 10: Rs 0.48, so Rs 0.
    expect(gstInsideRupees(11, 5)).toBe(1);
    expect(gstInsideRupees(10, 5)).toBe(0);
    expect(gstInsideRupees(118, 18)).toBe(18);
    expect(gstInsideRupees(140, 40)).toBe(40);
    expect(gstInsideRupees(500, 0)).toBe(0);
  });
});

describe('lineAmounts and orderTotals', () => {
  it('multiply the packs by the price, and find the GST in the line total', () => {
    expect(lineAmounts({ priceRupees: 449, packs: 3, gstRate: 5 })).toEqual({
      lineTotalRupees: 1_347,
      gstRupees: 64,
    });
  });

  it('add up the lines line by line, with free delivery from Rs 499', () => {
    expect(
      orderTotals([
        { priceRupees: 449, packs: 3, gstRate: 5 },
        { priceRupees: 799, packs: 1, gstRate: 5 },
      ]),
    ).toEqual({
      itemsTotalRupees: 2_146,
      // 64 + 38, each line rounded on its own.
      itemsGstRupees: 102,
      deliveryChargeRupees: 0,
      totalRupees: 2_146,
    });
  });

  it('round the GST of each line on its own, as the invoice will show it', () => {
    // Three lines of Rs 11 at 5%: Rs 0.52 each, so 1 + 1 + 1. The whole
    // Rs 33 at once would hold Rs 1.57, rounded to 2.
    const line = { priceRupees: 11, packs: 1, gstRate: 5 };
    expect(orderTotals([line, line, line]).itemsGstRupees).toBe(3);
  });

  it('add the delivery charge to a small order', () => {
    expect(orderTotals([{ priceRupees: 199, packs: 1, gstRate: 18 }])).toEqual({
      itemsTotalRupees: 199,
      itemsGstRupees: 30,
      deliveryChargeRupees: 49,
      totalRupees: 248,
    });
  });
});

describe('holdExpiresAt', () => {
  it('is 15 minutes after the order is placed', () => {
    expect(holdExpiresAt(new Date('2026-11-07T06:00:00.000Z'))).toEqual(
      new Date('2026-11-07T06:15:00.000Z'),
    );
  });
});

describe('newOrderReference', () => {
  it('turns each random byte into one of 32 characters that cannot be mistaken', () => {
    const bytes = Buffer.from([31, 32, 63, 255, 8, 13, 22, 23, 24, 30]);
    const random = jest.fn().mockReturnValue(bytes);

    expect(newOrderReference(random)).toBe('9A99JPYZ28');
    expect(random).toHaveBeenCalledWith(10);
    expect(REFERENCE_LENGTH).toBe(10);
  });

  it('is new each time, without I, O, 0 or 1', () => {
    const first = newOrderReference();
    const second = newOrderReference();

    expect(first).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(second).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(first).not.toBe(second);
  });

  it('is what ORDER_REFERENCE accepts, and nothing else', () => {
    expect(ORDER_REFERENCE.test(newOrderReference())).toBe(true);
    expect(ORDER_REFERENCE.test('7KQ2M9XDPA')).toBe(true);
    for (const wrong of [
      '7KQ2M9XDP',
      '7KQ2M9XDPAB',
      '7KQ2M9XDPI',
      '7kq2m9xdpa',
      '7KQ2M9XDP0',
    ]) {
      expect([wrong, ORDER_REFERENCE.test(wrong)]).toEqual([wrong, false]);
    }
  });
});
