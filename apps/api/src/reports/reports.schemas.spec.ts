import { salesReportQuerySchema } from './reports.schemas';

// The messages a query is refused with, by field.
function refusals(query: object) {
  const result = salesReportQuerySchema.safeParse(query);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe('salesReportQuerySchema', () => {
  it('takes a period of days in India, and ignores anything else', () => {
    expect(
      salesReportQuerySchema.parse({
        from: '2026-11-01',
        to: '2026-11-25',
        other: 'x',
      }),
    ).toEqual({ from: '2026-11-01', to: '2026-11-25' });
    expect(refusals({ from: '2026-11-25', to: '2026-11-25' })).toEqual([]);
  });

  it('needs both days, each a real date written like 2026-11-25', () => {
    const message = 'Use a date such as 2026-11-25';
    expect(refusals({})).toEqual([
      ['from', message],
      ['to', message],
    ]);
    for (const day of ['25-11-2026', '2026-11-5', '2026-02-30', '2026-13-01']) {
      expect(refusals({ from: day, to: '2026-11-25' })).toEqual([
        ['from', message],
      ]);
    }
  });

  it('refuses a period that starts after it ends', () => {
    expect(refusals({ from: '2026-11-26', to: '2026-11-25' })).toEqual([
      ['to', 'The period starts after it ends'],
    ]);
  });

  it('takes at most 3660 days', () => {
    expect(refusals({ from: '2016-11-18', to: '2026-11-25' })).toEqual([]);
    expect(refusals({ from: '2016-11-17', to: '2026-11-25' })).toEqual([
      ['to', 'Choose at most 3660 days'],
    ]);
  });

  it('narrows to a product, a category and a brand by their IDs, in small letters', () => {
    expect(
      salesReportQuerySchema.parse({
        from: '2026-11-01',
        to: '2026-11-25',
        productId: '7D6C5B4A-3F2E-4D1C-8B0A-9F8E7D6C5B41',
        categoryId: '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a61',
        brandId: '8C9D0E1F-2A3B-4C4D-8E5F-6A7B8C9D0E11',
      }),
    ).toEqual({
      from: '2026-11-01',
      to: '2026-11-25',
      productId: '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b41',
      categoryId: '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a61',
      brandId: '8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e11',
    });
    expect(
      refusals({
        from: '2026-11-01',
        to: '2026-11-25',
        productId: 'ashwagandha',
        categoryId: '',
        brandId: '1',
      }),
    ).toEqual([
      ['productId', 'Choose a product by its ID'],
      ['categoryId', 'Choose a category by its ID'],
      ['brandId', 'Choose a brand by its ID'],
    ]);
  });
});
