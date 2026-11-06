import {
  CART_FULL,
  cartTotals,
  lineStatus,
  MAX_CART_LINES,
  MAX_PACKS_PER_PRODUCT,
  OUT_OF_STOCK,
  packsRefusal,
  tooManyOfProduct,
} from './cart-rules';

// One pack of a pack size in stock, not yet in a cart that holds 3 other
// pack sizes, none of them of the same product.
const change = {
  packs: 1,
  currentPacks: 0,
  otherPacks: 0,
  lines: 3,
  inStock: true,
};

describe('the limits', () => {
  it('are 4 packs of one product and 50 pack sizes, as in the database', () => {
    expect(MAX_PACKS_PER_PRODUCT).toBe(4);
    expect(MAX_CART_LINES).toBe(50);
  });

  it('are explained in their messages', () => {
    expect(tooManyOfProduct(3)).toBe(
      'At most 4 packs of one product, all its pack sizes together. The cart already has 3 in other sizes.',
    );
    expect(CART_FULL).toBe(
      'A cart holds at most 50 pack sizes. Remove one first.',
    );
    expect(OUT_OF_STOCK).toBe('This pack size is out of stock.');
  });
});

describe('packsRefusal', () => {
  it('lets a pack size in stock in, up to 4 packs', () => {
    expect(packsRefusal(change)).toBeNull();
    expect(packsRefusal({ ...change, packs: 4 })).toBeNull();
  });

  it('counts the packs of the same product in its other sizes', () => {
    expect(packsRefusal({ ...change, packs: 1, otherPacks: 3 })).toBeNull();
    expect(packsRefusal({ ...change, packs: 2, otherPacks: 3 })).toBe(
      tooManyOfProduct(3),
    );
    expect(
      packsRefusal({ ...change, packs: 3, currentPacks: 2, otherPacks: 2 }),
    ).toBe(tooManyOfProduct(2));
  });

  it('refuses adding a pack size that is out of stock, or adding more of it', () => {
    expect(packsRefusal({ ...change, inStock: false })).toBe(OUT_OF_STOCK);
    expect(
      packsRefusal({ ...change, packs: 3, currentPacks: 2, inStock: false }),
    ).toBe(OUT_OF_STOCK);
  });

  it('always lets the packs go down or stay, even out of stock or over the limit', () => {
    expect(
      packsRefusal({ ...change, packs: 1, currentPacks: 3, inStock: false }),
    ).toBeNull();
    expect(
      packsRefusal({ ...change, packs: 2, currentPacks: 2, inStock: false }),
    ).toBeNull();
    expect(
      packsRefusal({ ...change, packs: 2, currentPacks: 3, otherPacks: 3 }),
    ).toBeNull();
  });

  it('refuses a 51st pack size, but not more packs of one already in the cart', () => {
    expect(packsRefusal({ ...change, lines: 49 })).toBeNull();
    expect(packsRefusal({ ...change, lines: 50 })).toBe(CART_FULL);
    expect(
      packsRefusal({ ...change, packs: 2, currentPacks: 1, lines: 50 }),
    ).toBeNull();
  });
});

describe('lineStatus', () => {
  it('is available only on sale and in stock', () => {
    expect(lineStatus(true, true)).toBe('AVAILABLE');
    expect(lineStatus(true, false)).toBe('OUT_OF_STOCK');
    expect(lineStatus(false, true)).toBe('OFF_SALE');
    expect(lineStatus(false, false)).toBe('OFF_SALE');
  });
});

describe('cartTotals', () => {
  it('adds up only the lines that can be bought now', () => {
    expect(
      cartTotals([
        { packs: 2, priceRupees: 449, mrpRupees: 500, status: 'AVAILABLE' },
        { packs: 1, priceRupees: 799, mrpRupees: 900, status: 'AVAILABLE' },
        { packs: 3, priceRupees: 199, mrpRupees: 250, status: 'OUT_OF_STOCK' },
        { packs: 1, priceRupees: 99, mrpRupees: 120, status: 'OFF_SALE' },
      ]),
    ).toEqual({ packs: 3, subtotalRupees: 1697, mrpTotalRupees: 1900 });
  });

  it('is nothing for an empty cart', () => {
    expect(cartTotals([])).toEqual({
      packs: 0,
      subtotalRupees: 0,
      mrpTotalRupees: 0,
    });
  });
});
