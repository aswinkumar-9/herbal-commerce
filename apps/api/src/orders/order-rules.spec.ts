import {
  CART_EMPTY,
  DELIVERY_CHARGE_PAISE,
  deliveryChargePaise,
  FREE_DELIVERY_FROM_PAISE,
  gstInsidePaise,
  HOLD_MINUTES,
  holdExpiresAt,
  lineAmounts,
  MAX_OPEN_ORDERS,
  newOrderReference,
  NOT_CANCELLABLE,
  notEnoughStock,
  notReady,
  orderTotals,
  REFERENCE_LENGTH,
  rupeesToPaise,
  TOO_MANY_OPEN,
  TOTAL_CHANGED,
} from './order-rules';

describe("the owner's numbers", () => {
  it('hold stock 15 minutes, and deliver free from Rs 499, else for Rs 49', () => {
    expect(HOLD_MINUTES).toBe(15);
    expect(FREE_DELIVERY_FROM_PAISE).toBe(49_900);
    expect(DELIVERY_CHARGE_PAISE).toBe(4_900);
  });

  it('let a customer have at most 3 orders waiting for payment', () => {
    expect(MAX_OPEN_ORDERS).toBe(3);
  });

  it('are explained in the messages', () => {
    expect(CART_EMPTY).toBe('The cart is empty.');
    expect(NOT_CANCELLABLE).toBe(
      'Only an order waiting for payment can be cancelled.',
    );
    expect(TOO_MANY_OPEN).toBe(
      'You have 3 orders waiting for payment. Pay for one or cancel it first.',
    );
    expect(TOTAL_CHANGED).toBe(
      'The total has changed. Check the cart and try again.',
    );
    expect(notReady(['ASH-CAP-60', 'TULSI-100'])).toBe(
      "These packs can't be ordered now: ASH-CAP-60, TULSI-100. Change or remove them first.",
    );
    expect(notEnoughStock('ASH-CAP-60')).toBe(
      'ASH-CAP-60 is out of stock, or not enough of it is left. Change it in the cart and try again.',
    );
  });
});

describe('deliveryChargePaise', () => {
  it('is Rs 49 below Rs 499, and free from Rs 499', () => {
    expect(deliveryChargePaise(100)).toBe(4_900);
    expect(deliveryChargePaise(49_800)).toBe(4_900);
    expect(deliveryChargePaise(49_899)).toBe(4_900);
    expect(deliveryChargePaise(49_900)).toBe(0);
    expect(deliveryChargePaise(250_000)).toBe(0);
  });
});

describe('gstInsidePaise', () => {
  it('finds the GST inside a price that includes it, rounded to the paisa', () => {
    // Rs 449 at 5%: Rs 21.38 (2138.09 paise).
    expect(gstInsidePaise(44_900, 5)).toBe(2_138);
    // Rs 1 at 5%: 4.76 paise, rounded up.
    expect(gstInsidePaise(100, 5)).toBe(5);
    expect(gstInsidePaise(11_800, 18)).toBe(1_800);
    expect(gstInsidePaise(14_000, 40)).toBe(4_000);
    expect(gstInsidePaise(50_000, 0)).toBe(0);
  });
});

describe('lineAmounts and orderTotals', () => {
  it('multiply the packs by the price, and find the GST in the line total', () => {
    expect(rupeesToPaise(449)).toBe(44_900);
    expect(lineAmounts({ pricePaise: 44_900, packs: 3, gstRate: 5 })).toEqual({
      lineTotalPaise: 134_700,
      gstPaise: 6_414,
    });
  });

  it('add up the lines line by line, with free delivery from Rs 499', () => {
    expect(
      orderTotals([
        { pricePaise: 44_900, packs: 3, gstRate: 5 },
        { pricePaise: 79_900, packs: 1, gstRate: 5 },
      ]),
    ).toEqual({
      itemsTotalPaise: 214_600,
      // 6414 + 3805, each line rounded on its own.
      itemsGstPaise: 10_219,
      deliveryChargePaise: 0,
      totalPaise: 214_600,
    });
  });

  it('round the GST of each line on its own, as the invoice will show it', () => {
    // Three lines of Rs 1 at 5%: 4.76 paise each, so 5 + 5 + 5. The whole
    // Rs 3 at once would hold 14.29 paise, rounded to 14.
    const rupee = { pricePaise: 100, packs: 1, gstRate: 5 };
    expect(orderTotals([rupee, rupee, rupee]).itemsGstPaise).toBe(15);
  });

  it('add the delivery charge to a small order', () => {
    expect(
      orderTotals([{ pricePaise: 19_900, packs: 1, gstRate: 18 }]),
    ).toEqual({
      itemsTotalPaise: 19_900,
      itemsGstPaise: 3_036,
      deliveryChargePaise: 4_900,
      totalPaise: 24_800,
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
});
