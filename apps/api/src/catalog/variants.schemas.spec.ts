import {
  priceIssues,
  variantSchema,
  variantUpdateSchema,
} from './variants.schemas';

const pack = {
  sku: 'ASH-CAP-60',
  quantity: 60,
  unit: 'CAPSULES',
  mrpPaise: 50000,
  pricePaise: 45000,
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
    expect(priceIssues({ mrpPaise: 50000, pricePaise: 50001 })).toEqual([
      { field: 'pricePaise', message: 'The price may not be more than the MRP' },
    ]);
    expect(priceIssues({ mrpPaise: 50000, pricePaise: 50000 })).toEqual([]);
    expect(priceIssues({ mrpPaise: 50000, pricePaise: 1 })).toEqual([]);
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
    expect(refusedFields({ ...pack, pricePaise: 50001 })).toEqual(['pricePaise']);
    expect(
      variantSchema.parse({ ...pack, pricePaise: 50000 }).pricePaise,
    ).toBe(50000);
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

  it('wants prices in whole paise, from 1 to Rs 10,00,000', () => {
    for (const mrpPaise of [0, -1, 450.5, '50000', 100_000_001]) {
      expect([mrpPaise, refusedFields({ ...pack, mrpPaise })]).toEqual([
        mrpPaise,
        ['mrpPaise'],
      ]);
    }
    expect(
      variantSchema.parse({ ...pack, mrpPaise: 100_000_000 }).mrpPaise,
    ).toBe(100_000_000);
  });
});

describe('variantUpdateSchema', () => {
  it('takes only the fields that change, and leaves price and MRP to be checked when saved', () => {
    expect(variantUpdateSchema.parse({ pricePaise: 60000 })).toEqual({
      pricePaise: 60000,
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
