import { productSearchQuerySchema } from './product-search.schemas';

// The fields a search is refused for, with their messages.
function refused(input: object): string[] {
  const result = productSearchQuerySchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
}

describe('productSearchQuerySchema', () => {
  it('answers the first 20 by name when nothing is asked, and by relevance once there are words', () => {
    expect(productSearchQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 20,
      sort: 'name',
    });
    expect(productSearchQuerySchema.parse({ q: 'ashwa' })).toEqual({
      q: 'ashwa',
      page: 1,
      limit: 20,
      sort: 'relevance',
    });
  });

  it('trims the words and makes each run of spaces one; empty words are none', () => {
    expect(productSearchQuerySchema.parse({ q: '  green \t  tea ' }).q).toBe(
      'green tea',
    );
    expect(productSearchQuerySchema.parse({ q: '   ' })).toEqual({
      q: undefined,
      page: 1,
      limit: 20,
      sort: 'name',
    });
  });

  it('needs 2 to 100 characters of words', () => {
    expect(refused({ q: ' a ' })).toEqual([
      'q: Search with at least 2 characters',
    ]);
    expect(refused({ q: 'ab' })).toEqual([]);
    expect(refused({ q: 'a'.repeat(100) })).toEqual([]);
    expect(refused({ q: 'a'.repeat(101) })).toEqual([
      'q: Search with at most 100 characters',
    ]);
  });

  it('takes a category by its slug, and a product type', () => {
    expect(
      productSearchQuerySchema.parse({
        category: 'herbal-teas',
        type: 'FOOD_OR_SUPPLEMENT',
      }),
    ).toMatchObject({ category: 'herbal-teas', type: 'FOOD_OR_SUPPLEMENT' });
    expect(refused({ category: 'Herbal Teas' })).toEqual([
      'category: A slug has lowercase letters, digits and single hyphens, like "hair-care"',
    ]);
    expect(refused({ type: 'TEA' })).toEqual([
      'type: Choose AYURVEDIC_MEDICINE, FOOD_OR_SUPPLEMENT or COSMETIC',
    ]);
  });

  it('takes prices in whole rupees, the lowest no higher than the highest', () => {
    expect(
      productSearchQuerySchema.parse({
        minPriceRupees: '200',
        maxPriceRupees: '500',
      }),
    ).toMatchObject({ minPriceRupees: 200, maxPriceRupees: 500 });
    expect(
      productSearchQuerySchema.parse({
        minPriceRupees: '300',
        maxPriceRupees: '300',
      }),
    ).toMatchObject({ minPriceRupees: 300, maxPriceRupees: 300 });
    expect(refused({ minPriceRupees: '199.50' })).toEqual([
      'minPriceRupees: Give a price in whole rupees',
    ]);
    expect(refused({ maxPriceRupees: '-1' })).toEqual([
      'maxPriceRupees: Give a price in whole rupees',
    ]);
    expect(refused({ maxPriceRupees: 'cheap' })).toEqual([
      'maxPriceRupees: Give a price in whole rupees',
    ]);
    expect(refused({ maxPriceRupees: '1000001' })).toEqual([
      'maxPriceRupees: Give a price of at most Rs 10,00,000',
    ]);
    expect(refused({ minPriceRupees: '501', maxPriceRupees: '500' })).toEqual([
      'minPriceRupees: The lowest price is above the highest',
    ]);
  });

  it('sorts as asked, and by relevance only with words', () => {
    for (const sort of ['price-asc', 'price-desc', 'name']) {
      expect(productSearchQuerySchema.parse({ q: 'tea', sort }).sort).toBe(
        sort,
      );
      expect(productSearchQuerySchema.parse({ sort }).sort).toBe(sort);
    }
    expect(refused({ sort: 'cheapest' })).toEqual([
      'sort: Choose relevance, price-asc, price-desc or name',
    ]);
    expect(refused({ sort: 'relevance' })).toEqual([
      'sort: Sorting by relevance needs search words',
    ]);
    expect(refused({ sort: 'relevance', q: ' ' })).toEqual([
      'sort: Sorting by relevance needs search words',
    ]);
  });

  it('pages from 1 to 100, 1 to 50 products at a time', () => {
    expect(
      productSearchQuerySchema.parse({ page: '3', limit: '50' }),
    ).toMatchObject({ page: 3, limit: 50 });
    expect(refused({ page: '0' })).toEqual(['page: Pages start at 1']);
    expect(refused({ page: '101' })).toEqual([
      'page: Give a page of at most 100',
    ]);
    expect(refused({ limit: '0' }).map((issue) => issue.split(':')[0])).toEqual(
      ['limit'],
    );
    expect(
      refused({ limit: '51' }).map((issue) => issue.split(':')[0]),
    ).toEqual(['limit']);
  });
});
