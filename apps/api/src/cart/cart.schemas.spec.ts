import { cartItemSchema } from './cart.schemas';

// The errors an invalid input gets, as "field: message".
function refusals(input: unknown): string[] {
  const result = cartItemSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
}

describe('cartItemSchema', () => {
  it('takes 1 to 4 packs, and drops unknown fields', () => {
    expect(cartItemSchema.parse({ packs: 1 })).toEqual({ packs: 1 });
    expect(
      cartItemSchema.parse({ packs: 4, sku: 'ASH-CAP-60', priceRupees: 1 }),
    ).toEqual({ packs: 4 });
  });

  it('refuses 0 and 5 packs, saying why', () => {
    expect(refusals({ packs: 0 })).toEqual([
      'packs: At least 1 pack. To take it out of the cart, delete it.',
    ]);
    expect(refusals({ packs: 5 })).toEqual([
      'packs: At most 4 packs of one product',
    ]);
  });

  it('refuses half a pack, a text, or nothing', () => {
    for (const input of [{ packs: 1.5 }, { packs: '2' }, {}, { packs: null }]) {
      expect(refusals(input).map((refusal) => refusal.split(':')[0])).toEqual([
        'packs',
      ]);
    }
  });
});
