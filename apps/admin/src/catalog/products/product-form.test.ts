import { describe, expect, it } from 'vitest';
import { OIL, SHAMPOO } from '../../test/catalog-fixtures';
import type { Product } from '../catalog-api';
import {
  NEEDED_MESSAGE,
  afterSave,
  changes,
  check,
  missingToGoLive,
  newProduct,
  startingValues,
  toFields,
} from './product-form';

const oil = OIL as Product;
const shampoo = SHAMPOO as Product;

describe('the product form', () => {
  it('starts a new product in the chosen category, made in India', () => {
    const values = startingValues(null, 'category-1');

    expect(values).toMatchObject({
      categoryId: 'category-1',
      name: '',
      type: '',
      countryOfOrigin: 'India',
      gstRate: '',
      isActive: false,
    });
  });

  it('starts from the product as it is', () => {
    expect(startingValues(shampoo)).toMatchObject({
      name: 'Amla Shampoo',
      type: 'COSMETIC',
      summary: 'A gentle amla shampoo',
      gstRate: '18',
      isActive: true,
    });
    expect(startingValues(oil).gstRate).toBe('');
    expect(startingValues({ ...shampoo, gstRate: 0 }).gstRate).toBe('0');
  });

  it('stores what is typed as the API would', () => {
    const fields = toFields({
      ...startingValues(oil),
      name: '  Bhringraj Oil ',
      summary: '   ',
      licenceNumber: ' 25d / 123 ',
      hsnCode: '3305 10',
      gstRate: '5',
      countryOfOrigin: ' Nepal ',
    });

    expect(fields).toMatchObject({
      name: 'Bhringraj Oil',
      summary: null,
      licenceNumber: '25D/123',
      hsnCode: '330510',
      gstRate: 5,
      countryOfOrigin: 'Nepal',
    });
  });

  it('never stores a GST rate the law does not allow', () => {
    expect(toFields({ ...startingValues(oil), gstRate: '7' }).gstRate).toBe(
      null,
    );
    expect(toFields({ ...startingValues(oil), gstRate: '0' }).gstRate).toBe(0);
  });

  it('sends a new product as a draft, and leaves an empty slug to the API', () => {
    const sent = newProduct({ ...startingValues(null, 'c1'), name: 'Neem' });

    expect(sent).not.toHaveProperty('isActive');
    expect(sent).not.toHaveProperty('slug');
    expect(
      newProduct({ ...startingValues(null, 'c1'), slug: ' neem ' }).slug,
    ).toBe('neem');
  });

  it('sends only what staff changed', () => {
    const initial = startingValues(shampoo);

    expect(changes(initial, initial)).toEqual({});
    // A change the API would store the same way is no change.
    expect(
      changes(
        {
          ...initial,
          summary: ' A gentle amla shampoo ',
          licenceNumber: 'mh/25/123',
        },
        initial,
      ),
    ).toEqual({});
    expect(
      changes(
        { ...initial, summary: '', gstRate: '5', isActive: false },
        initial,
      ),
    ).toEqual({ summary: null, gstRate: 5, isActive: false });
  });

  it('keeps what was typed while a change was being saved', () => {
    const sent = { ...startingValues(oil), name: 'Bhringraj Hair Oil' };
    const current = { ...sent, summary: 'Typed meanwhile' };
    const saved = startingValues({
      ...oil,
      name: 'Bhringraj Hair Oil',
      slug: 'b',
    });

    expect(afterSave(current, sent, saved)).toEqual({
      ...saved,
      summary: 'Typed meanwhile',
    });
  });

  it('names what a product still needs to go live', () => {
    expect(missingToGoLive(oil)).toEqual([
      'Type',
      'Licence number',
      'Manufacturer',
      "Manufacturer's address",
      'Ingredients',
      'HSN code',
      'GST rate',
    ]);
    expect(missingToGoLive(shampoo)).toEqual([]);
    expect(missingToGoLive({ ...shampoo, gstRate: 0 })).toEqual([]);
  });
});

describe('the checks before sending', () => {
  const valid = startingValues(shampoo);

  it('passes a complete product', () => {
    expect(check(valid, shampoo)).toEqual({});
  });

  it('needs a name and a category', () => {
    expect(
      check({ ...valid, name: '  ', categoryId: '' }, shampoo),
    ).toMatchObject({
      name: 'Enter a name',
      categoryId: 'Choose a category',
    });
  });

  it('checks the slug', () => {
    expect(check({ ...valid, slug: 'Amla Shampoo' }, shampoo).slug).toMatch(
      /^Use lowercase letters/,
    );
    expect(check({ ...valid, slug: '' }, shampoo).slug).toBe('Enter a slug');
    // A new product's slug may be left to the API, unless the name has no
    // Latin letters.
    expect(check({ ...valid, slug: '' }, null).slug).toBeUndefined();
    expect(check({ ...valid, slug: '', name: 'आंवला' }, null).slug).toBe(
      'The name has no Latin letters or digits: enter a slug',
    );
  });

  it('checks the licence number, and an FSSAI one has 14 digits', () => {
    expect(
      check({ ...valid, licenceNumber: 'MH#25' }, shampoo).licenceNumber,
    ).toBe('Use letters, digits, "/", "." and "-" only');
    const food = { ...valid, type: 'FOOD_OR_SUPPLEMENT' as const };
    expect(
      check({ ...food, licenceNumber: '1234' }, shampoo).licenceNumber,
    ).toBe('An FSSAI licence number has exactly 14 digits');
    expect(
      check({ ...food, licenceNumber: '1234 5678 9012 34' }, shampoo)
        .licenceNumber,
    ).toBeUndefined();
    // A draft may leave it empty.
    expect(
      check({ ...food, licenceNumber: '', isActive: false }, shampoo)
        .licenceNumber,
    ).toBeUndefined();
  });

  it('checks the country and the HSN code', () => {
    const found = check(
      { ...valid, countryOfOrigin: ' I ', hsnCode: '33051' },
      shampoo,
    );

    expect(found.countryOfOrigin).toBe('Enter the country of origin');
    expect(found.hsnCode).toBe('An HSN code has 4, 6 or 8 digits');
    expect(
      check({ ...valid, hsnCode: '3305 1090' }, shampoo).hsnCode,
    ).toBeUndefined();
  });

  it('marks every detail a live product lacks, and none for a draft', () => {
    const empty = startingValues(oil);

    expect(check({ ...empty, isActive: true }, oil)).toEqual({
      type: NEEDED_MESSAGE,
      licenceNumber: NEEDED_MESSAGE,
      manufacturerName: NEEDED_MESSAGE,
      manufacturerAddress: NEEDED_MESSAGE,
      ingredients: NEEDED_MESSAGE,
      hsnCode: NEEDED_MESSAGE,
      gstRate: NEEDED_MESSAGE,
    });
    expect(check(empty, oil)).toEqual({});
    // A wrong HSN code is said, not that one is needed.
    expect(
      check({ ...empty, isActive: true, hsnCode: '12' }, oil).hsnCode,
    ).toBe('An HSN code has 4, 6 or 8 digits');
  });
});
