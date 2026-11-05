import {
  priceIssues,
  variantSchema,
  variantUpdateSchema,
} from './variants.schemas';

const pack = {
  sku: 'ASH-CAP-60',
  quantity: 60,
  unit: 'CAPSULES',
  mrpRupees: 500,
  priceRupees: 450,
};

// The fields an invalid pack is refused for.
function refusedFields(input: object): string[] {
  const result = variantSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('priceIssues', () => {
  it('refuses a price above the MRP, and allows one up to it', () => {
    expect(priceIssues({ mrpRupees: 500, priceRupees: 501 })).toEqual([
      { field: 'priceRupees', message: 'The price may not be more than the MRP' },
    ]);
    expect(priceIssues({ mrpRupees: 500, priceRupees: 500 })).toEqual([]);
    expect(priceIssues({ mrpRupees: 500, priceRupees: 1 })).toEqual([]);
  });
});

describe('variantSchema', () => {
  it('takes a pack size, writes the SKU in capitals, and drops unknown fields', () => {
    expect(
      variantSchema.parse({ ...pack, sku: ' ash-cap-60 ', productId: 'chosen' }),
    ).toEqual(pack);
    expect(
      variantSchema.parse({ ...pack, isActive: false, position: 2 }),
    ).toEqual({ ...pack, isActive: false, position: 2 });
  });

  it('refuses a price above the MRP, on the price', () => {
    expect(refusedFields({ ...pack, priceRupees: 501 })).toEqual(['priceRupees']);
    expect(
      variantSchema.parse({ ...pack, priceRupees: 500 }).priceRupees,
    ).toBe(500);
  });

  it('wants an SKU of letters, digits and single hyphens', () => {
    const wrong = ['AB', 'ASH_CAP', 'ASH--CAP', '-ASH', 'ASH CAP', 'X'.repeat(41)];
    for (const sku of wrong) {
      expect([sku, refusedFields({ ...pack, sku })]).toEqual([sku, ['sku']]);
    }
  });

  it('wants a whole quantity and a unit from the list', () => {
    for (const quantity of [0, -1, 1.5, '60', 1_000_001]) {
      expect([quantity, refusedFields({ ...pack, quantity })]).toEqual([
        quantity,
        ['quantity'],
      ]);
    }
    for (const unit of ['GRAMS', 'g', 'capsules']) {
      expect([unit, refusedFields({ ...pack, unit })]).toEqual([unit, ['unit']]);
    }
  });

  it('wants prices in whole rupees, from 1 to 10,00,000', () => {
    for (const mrpRupees of [0, -1, 450.5, '500', 1_000_001]) {
      expect([mrpRupees, refusedFields({ ...pack, mrpRupees })]).toEqual([
        mrpRupees,
        ['mrpRupees'],
      ]);
    }
    expect(
      variantSchema.parse({ ...pack, mrpRupees: 1_000_000 }).mrpRupees,
    ).toBe(1_000_000);
  });
});

describe('variantUpdateSchema', () => {
  it('takes only the fields that change, and leaves price and MRP to be checked when saved', () => {
    expect(variantUpdateSchema.parse({ priceRupees: 600 })).toEqual({
      priceRupees: 600,
    });
    expect(variantUpdateSchema.parse({ sku: 'ash-cap-90', isActive: false })).toEqual({
      sku: 'ASH-CAP-90',
      isActive: false,
    });
  });

  it('refuses a change with nothing in it', () => {
    expect(variantUpdateSchema.safeParse({}).success).toBe(false);
    expect(variantUpdateSchema.safeParse({ productId: 'x' }).success).toBe(false);
  });
});
