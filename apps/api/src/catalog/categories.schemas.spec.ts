import {
  categoryOrderSchema,
  categorySchema,
  categoryUpdateSchema,
} from './categories.schemas';

describe('categorySchema', () => {
  it('makes the slug from the name, and keeps it hidden unless asked', () => {
    expect(categorySchema.parse({ name: ' Hair Care ' })).toEqual({
      name: 'Hair Care',
      slug: 'hair-care',
    });
  });

  it('takes a given slug instead, for a name without Latin letters', () => {
    expect(
      categorySchema.parse({ name: 'आयुर्वेद', slug: 'ayurveda' }).slug,
    ).toBe('ayurveda');
    const missing = categorySchema.safeParse({ name: 'आयुर्वेद' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0].path).toEqual(['slug']);
  });

  it('refuses a slug that is not lowercase letters, digits and single hyphens', () => {
    const wrong = ['Hair-Care', 'hair care', 'hair--care', '-hair', 'hair_care', ''];
    for (const slug of wrong) {
      expect([slug, categorySchema.safeParse({ name: 'Hair', slug }).success])
        .toEqual([slug, false]);
    }
  });

  it('takes a description, a position and isActive, and drops anything else', () => {
    expect(
      categorySchema.parse({
        name: 'Hair Care',
        description: ' Oils and powders for the hair ',
        position: 2,
        isActive: true,
        id: 'chosen-by-the-client',
      }),
    ).toEqual({
      name: 'Hair Care',
      slug: 'hair-care',
      description: 'Oils and powders for the hair',
      position: 2,
      isActive: true,
    });
    expect(
      categorySchema.parse({ name: 'Hair Care', description: ' ' }).description,
    ).toBeNull();
  });

  it('checks the length of the name and description, and the position', () => {
    const accepts = (changes: object) =>
      categorySchema.safeParse({ name: 'Hair Care', ...changes }).success;
    expect(accepts({ name: ' ' })).toBe(false);
    expect(accepts({ name: 'x'.repeat(61) })).toBe(false);
    expect(accepts({ description: 'x'.repeat(501) })).toBe(false);
    for (const position of [-1, 1.5, 10000, '2']) {
      expect([position, accepts({ position })]).toEqual([position, false]);
    }
  });
});

describe('categoryUpdateSchema', () => {
  it('takes only the fields that change, and keeps the slug on a rename', () => {
    expect(categoryUpdateSchema.parse({ name: ' Hair & Scalp ' })).toEqual({
      name: 'Hair & Scalp',
    });
    expect(categoryUpdateSchema.parse({ slug: 'hair-scalp' })).toEqual({
      slug: 'hair-scalp',
    });
  });

  it('activates or deactivates, and clears the description with null', () => {
    expect(categoryUpdateSchema.parse({ isActive: false })).toEqual({
      isActive: false,
    });
    expect(categoryUpdateSchema.parse({ description: null })).toEqual({
      description: null,
    });
  });

  it('refuses a change with nothing in it', () => {
    expect(categoryUpdateSchema.safeParse({}).success).toBe(false);
    expect(categoryUpdateSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

describe('categoryOrderSchema', () => {
  const A = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const B = '8d0f7780-8536-41ef-a55c-f18c2b01bf18';
  const refused = (input: object) => {
    const result = categoryOrderSchema.safeParse(input);
    return result.success
      ? []
      : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  };

  it('takes every category, first to last', () => {
    expect(categoryOrderSchema.parse({ ids: [B, A], other: 1 })).toEqual({ ids: [B, A] });
  });

  it('refuses an empty list, a category twice, a bad ID and more than 500', () => {
    expect(refused({ ids: [] })).toEqual([['ids', 'List the categories']]);
    expect(refused({ ids: [A, B, A] })).toEqual([['ids', 'List each category once']]);
    expect(refused({ ids: ['hair-care'] })).toEqual([['ids.0', 'Each category by its ID']]);
    const many = Array.from(
      { length: 501 },
      (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    );
    expect(refused({ ids: many })).toEqual([['ids', 'At most 500 categories']]);
  });
});
