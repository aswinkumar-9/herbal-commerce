import { describe, expect, it } from 'vitest';
import type { Variant } from '../catalog-api';
import {
  changes,
  check,
  packName,
  priceHint,
  rupees,
  startingValues,
  toFields,
  wholeNumber,
} from './pack-size-form';
import type { PackValues } from './pack-size-form';

const PACK: Variant = {
  id: '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d',
  productId: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a',
  sku: 'AML-SHA-100',
  quantity: 100,
  unit: 'ML',
  mrpRupees: 250,
  priceRupees: 225,
  isActive: true,
  position: 0,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

const filled: PackValues = {
  quantity: '100',
  unit: 'ML',
  sku: 'aml-sha-100',
  mrpRupees: '250',
  priceRupees: '225',
  isActive: true,
};

describe('a pack size on screen', () => {
  it.each([
    [{ quantity: 100, unit: 'ML' }, '100 ml'],
    [{ quantity: 1, unit: 'L' }, '1 L'],
    [{ quantity: 60, unit: 'CAPSULES' }, '60 capsules'],
    [{ quantity: 1, unit: 'TABLETS' }, '1 tablet'],
    [{ quantity: 1, unit: 'PIECES' }, '1 piece'],
    [{ quantity: 1500, unit: 'G' }, '1,500 g'],
    [{ quantity: 100000, unit: 'G' }, '1,00,000 g'],
  ] as const)('%o is "%s"', (pack, name) => {
    expect(packName(pack)).toBe(name);
  });

  it('shows rupees grouped the Indian way, with no paise', () => {
    expect(rupees(499)).toBe('₹499');
    expect(rupees(1000000)).toBe('₹10,00,000');
  });
});

describe('the numbers staff type', () => {
  it.each([
    ['499', 499],
    [' 1,000 ', 1000],
    ['₹499', 499],
    ['0499', 499],
    ['499.50', null],
    ['49 9.5', null],
    ['-5', null],
    ['1e3', null],
    ['12345678', null],
    ['', null],
  ])('%j is %s', (text, value) => {
    expect(wholeNumber(text)).toBe(value);
  });
});

describe('checking a pack size', () => {
  it('passes one that is filled in right', () => {
    expect(check(filled)).toEqual({});
  });

  it('asks for every field of an empty one', () => {
    expect(check(startingValues(null))).toEqual({
      quantity: 'Enter the quantity on the label',
      unit: 'Choose a unit',
      sku: 'Enter an SKU',
      mrpRupees: 'Enter the MRP printed on the pack',
      priceRupees: 'Enter the price customers pay',
    });
  });

  it('takes whole numbers only, from 1 to 10,00,000', () => {
    expect(
      check({
        ...filled,
        quantity: '2.5',
        mrpRupees: '499.50',
        priceRupees: '0',
      }),
    ).toEqual({
      quantity: 'A whole number, like 100',
      mrpRupees: 'Whole rupees only, like 499',
      priceRupees: 'Between ₹1 and ₹10,00,000',
    });
    expect(
      check({ ...filled, quantity: '1000001', mrpRupees: '1000001' }),
    ).toMatchObject({
      quantity: 'Between 1 and 10,00,000',
      mrpRupees: 'Between ₹1 and ₹10,00,000',
    });
    expect(
      check({ ...filled, quantity: '1,000,000', mrpRupees: '10,00,000' }),
    ).toEqual({});
  });

  it('never lets the price go above the MRP', () => {
    expect(check({ ...filled, priceRupees: '251' })).toEqual({
      priceRupees: 'The price may not be more than the MRP',
    });
    expect(check({ ...filled, priceRupees: '250' })).toEqual({});
    // A wrong MRP gets one mark, not a second one on the price.
    expect(check({ ...filled, mrpRupees: 'abc', priceRupees: '251' })).toEqual({
      mrpRupees: 'Whole rupees only, like 499',
    });
  });

  it.each([
    ['AB', 'An SKU has at least 3 characters'],
    ['A'.repeat(41), 'An SKU has at most 40 characters'],
    [
      'ASH CAP 60',
      'An SKU has letters, digits and single hyphens, like "ASH-CAP-60"',
    ],
    [
      'ASH--CAP',
      'An SKU has letters, digits and single hyphens, like "ASH-CAP-60"',
    ],
    [
      '-ASH-CAP',
      'An SKU has letters, digits and single hyphens, like "ASH-CAP-60"',
    ],
    [
      'ASH_CAP',
      'An SKU has letters, digits and single hyphens, like "ASH-CAP-60"',
    ],
  ])('refuses the SKU %j', (sku, message) => {
    expect(check({ ...filled, sku })).toEqual({ sku: message });
  });
});

describe('what is sent', () => {
  it('sends a new pack size as numbers, with its SKU in capitals', () => {
    expect(
      toFields({ ...filled, sku: '  aml-sha-100 ', mrpRupees: '1,250' }),
    ).toEqual({
      sku: 'AML-SHA-100',
      quantity: 100,
      unit: 'ML',
      mrpRupees: 1250,
      priceRupees: 225,
      isActive: true,
    });
  });

  it('sends only what changed', () => {
    const start = startingValues(PACK);
    expect(start).toEqual({ ...filled, sku: 'AML-SHA-100' });
    expect(changes(start, PACK)).toEqual({});
    expect(changes({ ...start, sku: 'aml-sha-100' }, PACK)).toEqual({});
    expect(
      changes({ ...start, priceRupees: '199', isActive: false }, PACK),
    ).toEqual({ priceRupees: 199, isActive: false });
  });
});

describe('the price hint', () => {
  it('says how far below the MRP the price is', () => {
    expect(priceHint(filled)).toBe('₹25 off the MRP.');
    expect(priceHint({ ...filled, priceRupees: '250' })).toBe(
      'The same as the MRP.',
    );
    expect(priceHint({ ...filled, priceRupees: '' })).toBe(
      'What customers pay: at most the MRP.',
    );
    expect(priceHint({ ...filled, priceRupees: '300' })).toBe(
      'What customers pay: at most the MRP.',
    );
  });
});
