import { describe, expect, it } from 'vitest';
import { HAIR, HIMALAYA, SKIN } from '../test/catalog-fixtures';
import {
  MATCHES_SHOWN,
  catalogMatches,
  filterFrom,
  filterParams,
  isFiltered,
  keepsProducts,
} from './sales-filters';

const PRODUCT = '7D6C5B4A-3F2E-4D1C-8B0A-9F8E7D6C5B41';
const OILS = {
  ...HAIR,
  id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Hair Oils',
  slug: 'hair-oils',
  parentId: HAIR.id,
};

describe('the filter in the address', () => {
  it('takes IDs, in small letters, and leaves out anything else', () => {
    const params = new URLSearchParams({
      productId: PRODUCT,
      categoryId: 'hair-care',
      brandId: HIMALAYA.id,
      other: 'x',
    });
    expect(filterFrom(params)).toEqual({
      product: PRODUCT.toLowerCase(),
      brand: HIMALAYA.id,
    });
    expect(filterFrom(new URLSearchParams())).toEqual({});
  });

  it('goes back into the address as the API takes it', () => {
    expect(
      filterParams({ product: 'p', category: undefined, brand: 'b' }),
    ).toEqual({ productId: 'p', brandId: 'b' });
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ product: undefined })).toBe(false);
    expect(isFiltered({ category: 'c' })).toBe(true);
  });
});

describe('a search of the categories and brands', () => {
  it('finds a name holding the words, whatever their case, a subcategory with its top category', () => {
    expect(catalogMatches('OIL', [HAIR, SKIN, OILS], [HIMALAYA])).toEqual([
      { kind: 'category', id: OILS.id, name: 'Hair Care › Hair Oils' },
    ]);
    expect(catalogMatches('hima', [HAIR], [HIMALAYA])).toEqual([
      { kind: 'brand', id: HIMALAYA.id, name: 'Himalaya' },
    ]);
    expect(catalogMatches('  ', [HAIR], [HIMALAYA])).toEqual([]);
  });

  it('puts names that start with the words first, then by name, at most 5 of each', () => {
    expect(
      catalogMatches('hair', [OILS, SKIN, HAIR], []).map((match) => match.name),
    ).toEqual(['Hair Care', 'Hair Care › Hair Oils']);
    const care = catalogMatches('care', [SKIN, HAIR], []);
    expect(care.map((match) => match.name)).toEqual(['Hair Care', 'Skin Care']);
    // "Oils" starts with the words, so it comes before "Hair … Oils".
    const TOP_OILS = { ...HAIR, id: 'top-oils', name: 'Oils', parentId: null };
    expect(
      catalogMatches('oil', [HAIR, OILS, TOP_OILS], []).map(
        (match) => match.name,
      ),
    ).toEqual(['Oils', 'Hair Care › Hair Oils']);

    const many = Array.from({ length: 8 }, (_, i) => ({
      ...HIMALAYA,
      id: `brand-${i}`,
      name: `Brand ${8 - i}`,
    }));
    const found = catalogMatches('brand', [], many);
    expect(found).toHaveLength(MATCHES_SHOWN);
    expect(found[0]?.name).toBe('Brand 1');
  });
});

describe('narrowing by place', () => {
  it('takes a state as written and a way of paying the API knows, the unrecorded too', () => {
    expect(
      filterFrom(new URLSearchParams('state=Tamil+Nadu&method=UPI')),
    ).toEqual({ state: 'Tamil Nadu', method: 'UPI' });
    expect(filterFrom(new URLSearchParams('method=NOT_RECORDED'))).toEqual({
      method: 'NOT_RECORDED',
    });
    expect(filterFrom(new URLSearchParams(`state=+&method=CASH`))).toEqual({});
    expect(filterFrom(new URLSearchParams({ state: 'x'.repeat(61) }))).toEqual(
      {},
    );
    expect(
      filterParams({ product: 'p1', state: 'Kerala', method: 'CARD' }),
    ).toEqual({ productId: 'p1', state: 'Kerala', method: 'CARD' });
  });

  it('says whether only some products are kept', () => {
    expect(keepsProducts({ state: 'Kerala', method: 'UPI' })).toBe(false);
    expect(keepsProducts({ brand: 'b1', state: 'Kerala' })).toBe(true);
    expect(isFiltered({ method: 'UPI' })).toBe(true);
    expect(isFiltered({})).toBe(false);
  });
});
