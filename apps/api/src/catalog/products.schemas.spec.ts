import {
  productListQuerySchema,
  productSchema,
  productUpdateSchema,
} from './products.schemas';

const CATEGORY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const draft = { categoryId: CATEGORY, name: ' Ashwagandha Capsules ' };
const details = {
  type: 'AYURVEDIC_MEDICINE',
  licenceNumber: '25D/123/2015',
  manufacturerName: 'Herbal Works Pvt Ltd',
  manufacturerAddress: '12, Industrial Area, Mysuru 570016',
  ingredients: 'Each capsule contains: Ashwagandha root extract 500 mg',
};

// The fields an invalid input is refused for.
function refusedFields(input: object): string[] {
  const result = productSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('productSchema', () => {
  it('saves a draft with only a category and a name, and makes the slug', () => {
    expect(productSchema.parse(draft)).toEqual({
      categoryId: CATEGORY,
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
    });
  });

  it('needs a category by its ID', () => {
    expect(refusedFields({ name: 'Tulsi Tea' })).toEqual(['categoryId']);
    expect(refusedFields({ ...draft, categoryId: 'hair-care' })).toEqual([
      'categoryId',
    ]);
  });

  it('takes a given slug, and needs one for a name without Latin letters', () => {
    expect(productSchema.parse({ ...draft, slug: 'ashwagandha' }).slug).toBe(
      'ashwagandha',
    );
    expect(refusedFields({ categoryId: CATEGORY, name: 'अश्वगंधा' })).toEqual([
      'slug',
    ]);
    expect(refusedFields({ ...draft, slug: 'Ashwagandha_Capsules' })).toEqual([
      'slug',
    ]);
  });

  it('refuses to go live without the licence and maker details and the ingredients', () => {
    expect(refusedFields({ ...draft, isActive: true })).toEqual([
      'type',
      'licenceNumber',
      'manufacturerName',
      'manufacturerAddress',
      'ingredients',
    ]);
    expect(
      productSchema.parse({ ...draft, ...details, isActive: true }),
    ).toMatchObject({ isActive: true, type: 'AYURVEDIC_MEDICINE' });
  });

  it('writes a licence number in one form, and checks an FSSAI one', () => {
    expect(
      productSchema.parse({ ...draft, licenceNumber: ' 25d / 123 / 2015 ' })
        .licenceNumber,
    ).toBe('25D/123/2015');
    expect(
      productSchema.parse({
        ...draft,
        type: 'FOOD_OR_SUPPLEMENT',
        licenceNumber: '1234 5678 9012 34',
      }).licenceNumber,
    ).toBe('12345678901234');
    expect(
      refusedFields({ ...draft, type: 'FOOD_OR_SUPPLEMENT', licenceNumber: '1234' }),
    ).toEqual(['licenceNumber']);
    expect(refusedFields({ ...draft, licenceNumber: '#123' })).toEqual([
      'licenceNumber',
    ]);
    expect(
      productSchema.parse({ ...draft, licenceNumber: ' ' }).licenceNumber,
    ).toBeNull();
  });

  it('knows only the three product types', () => {
    expect(refusedFields({ ...draft, type: 'HERBAL' })).toEqual(['type']);
    expect(refusedFields({ ...draft, type: 'cosmetic' })).toEqual(['type']);
  });

  it('trims the texts, makes empty ones null, and drops unknown fields', () => {
    expect(
      productSchema.parse({
        ...draft,
        summary: ' Calm and strength ',
        description: ' ',
        usage: '',
        countryOfOrigin: ' India ',
        position: 3,
        id: 'chosen-by-the-client',
      }),
    ).toEqual({
      categoryId: CATEGORY,
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
      summary: 'Calm and strength',
      description: null,
      usage: null,
      countryOfOrigin: 'India',
      position: 3,
    });
  });

  it('checks the lengths, the country and the position', () => {
    const tooLong: [string, number][] = [
      ['name', 101],
      ['summary', 161],
      ['description', 5001],
      ['ingredients', 2001],
      ['usage', 2001],
      ['licenceNumber', 51],
      ['manufacturerName', 201],
      ['manufacturerAddress', 501],
      ['countryOfOrigin', 61],
    ];
    for (const [field, length] of tooLong) {
      expect([field, refusedFields({ ...draft, [field]: '1'.repeat(length) })]).toEqual(
        [field, [field]],
      );
    }
    expect(refusedFields({ ...draft, countryOfOrigin: ' ' })).toEqual([
      'countryOfOrigin',
    ]);
    expect(refusedFields({ ...draft, countryOfOrigin: null })).toEqual([
      'countryOfOrigin',
    ]);
    for (const position of [-1, 1.5, 10000, '2']) {
      expect([position, refusedFields({ ...draft, position })]).toEqual([
        position,
        ['position'],
      ]);
    }
  });
});

describe('productUpdateSchema', () => {
  it('takes only the fields that change, and keeps the slug on a rename', () => {
    expect(productUpdateSchema.parse({ name: ' Ashwagandha Tablets ' })).toEqual({
      name: 'Ashwagandha Tablets',
    });
    expect(productUpdateSchema.parse({ categoryId: CATEGORY })).toEqual({
      categoryId: CATEGORY,
    });
  });

  it('clears an optional field with null, but never the country', () => {
    expect(
      productUpdateSchema.parse({ licenceNumber: null, summary: null }),
    ).toEqual({ licenceNumber: null, summary: null });
    expect(
      productUpdateSchema.safeParse({ countryOfOrigin: null }).success,
    ).toBe(false);
  });

  it('refuses a change with nothing in it, or a category that is not an ID', () => {
    expect(productUpdateSchema.safeParse({}).success).toBe(false);
    expect(productUpdateSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(
      productUpdateSchema.safeParse({ categoryId: 'hair-care' }).success,
    ).toBe(false);
  });
});

describe('productListQuerySchema', () => {
  it('turns the query text into a page size and filters, 50 by default', () => {
    expect(productListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      productListQuerySchema.parse({
        limit: '20',
        after: CATEGORY,
        categoryId: CATEGORY,
        isActive: 'false',
        sort: 'price',
      }),
    ).toEqual({ limit: 20, after: CATEGORY, categoryId: CATEGORY, isActive: false });
    expect(productListQuerySchema.parse({ isActive: 'true' }).isActive).toBe(true);
  });

  it('refuses a page size outside 1 to 100, and filters that are not IDs or true or false', () => {
    const wrong = [
      { limit: '0' },
      { limit: '101' },
      { limit: 'ten' },
      { after: 'last' },
      { categoryId: 'hair-care' },
      { isActive: 'yes' },
    ];
    for (const query of wrong) {
      expect([query, productListQuerySchema.safeParse(query).success]).toEqual([
        query,
        false,
      ]);
    }
  });
});
