import { productIssues } from './product-rules';
import type { ProductState } from './product-rules';

const draft: ProductState = {
  isActive: false,
  type: null,
  licenceNumber: null,
  manufacturerName: null,
  manufacturerAddress: null,
  ingredients: null,
  hsnCode: null,
  gstRate: null,
  imageCount: 0,
};
const complete: ProductState = {
  isActive: true,
  type: 'AYURVEDIC_MEDICINE',
  licenceNumber: '25D/123/2015',
  manufacturerName: 'Herbal Works Pvt Ltd',
  manufacturerAddress: '12, Industrial Area, Mysuru 570016',
  ingredients: 'Each capsule contains: Ashwagandha root extract 500 mg',
  hsnCode: '3004',
  gstRate: 5,
  imageCount: 1,
};

describe('productIssues', () => {
  it('lets a draft lack every detail', () => {
    expect(productIssues(draft)).toEqual([]);
  });

  it('names each detail a live product still needs, and an image', () => {
    expect(productIssues({ ...draft, isActive: true })).toEqual(
      [
        'type',
        'licenceNumber',
        'manufacturerName',
        'manufacturerAddress',
        'ingredients',
        'hsnCode',
        'gstRate',
        'images',
      ].map((field) => ({
        field,
        message: 'Needed before the product can go live',
      })),
    );
    expect(
      productIssues({ ...complete, ingredients: null }),
    ).toEqual([
      { field: 'ingredients', message: 'Needed before the product can go live' },
    ]);
  });

  it('lets a complete product go live', () => {
    expect(productIssues(complete)).toEqual([]);
  });

  it('treats a detail or an image count that is missing altogether like an empty one', () => {
    const { hsnCode, licenceNumber, imageCount, ...rest } = complete;
    expect([hsnCode, licenceNumber, imageCount]).toEqual(['3004', '25D/123/2015', 1]);
    expect(
      productIssues({ ...rest, type: 'FOOD_OR_SUPPLEMENT' } as ProductState),
    ).toEqual([
      { field: 'licenceNumber', message: 'Needed before the product can go live' },
      { field: 'hsnCode', message: 'Needed before the product can go live' },
      { field: 'images', message: 'Needed before the product can go live' },
    ]);
  });

  it('wants at least one image before a product goes live, but not in a draft', () => {
    expect(productIssues({ ...complete, imageCount: 0 })).toEqual([
      { field: 'images', message: 'Needed before the product can go live' },
    ]);
    expect(productIssues({ ...complete, imageCount: 6 })).toEqual([]);
    expect(
      productIssues({ ...complete, isActive: false, imageCount: 0 }),
    ).toEqual([]);
  });

  it('wants exactly 14 digits for an FSSAI licence, even in a draft', () => {
    const food = { ...draft, type: 'FOOD_OR_SUPPLEMENT' as const };
    const wrong = ['1234', '1234567890123', '123456789012345', '1234567890123A'];
    for (const licenceNumber of wrong) {
      expect([licenceNumber, productIssues({ ...food, licenceNumber })]).toEqual([
        licenceNumber,
        [
          {
            field: 'licenceNumber',
            message: 'An FSSAI licence number has exactly 14 digits',
          },
        ],
      ]);
    }
    expect(
      productIssues({ ...food, licenceNumber: '12345678901234' }),
    ).toEqual([]);
    // No licence yet: nothing to check in a draft.
    expect(productIssues(food)).toEqual([]);
  });

  it('leaves the format of other licences to staff', () => {
    for (const type of ['AYURVEDIC_MEDICINE', 'COSMETIC'] as const) {
      expect(productIssues({ ...complete, type, licenceNumber: 'AUS-1234' })).toEqual(
        [],
      );
    }
  });
});
