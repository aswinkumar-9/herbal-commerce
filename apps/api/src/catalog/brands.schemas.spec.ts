import { brandSchema, brandUpdateSchema } from './brands.schemas';

describe('brandSchema', () => {
  it('makes the slug from the name', () => {
    expect(brandSchema.parse({ name: ' Himalaya Herbals ' })).toEqual({
      name: 'Himalaya Herbals',
      slug: 'himalaya-herbals',
    });
  });

  it('takes a given slug instead, for a name without Latin letters', () => {
    expect(brandSchema.parse({ name: 'पतंजलि', slug: 'patanjali' }).slug).toBe(
      'patanjali',
    );
    const missing = brandSchema.safeParse({ name: 'पतंजलि' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0].path).toEqual(['slug']);
  });

  it('refuses a slug that is not lowercase letters, digits and single hyphens', () => {
    for (const slug of [
      'Himalaya',
      'hima laya',
      'hima--laya',
      '-himalaya',
      '',
    ]) {
      expect([
        slug,
        brandSchema.safeParse({ name: 'Himalaya', slug }).success,
      ]).toEqual([slug, false]);
    }
  });

  it('checks the length of the name, and drops anything else', () => {
    expect(brandSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(brandSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
    expect(
      brandSchema.parse({ name: 'Dabur', id: 'chosen-by-the-client' }),
    ).toEqual({ name: 'Dabur', slug: 'dabur' });
  });
});

describe('brandUpdateSchema', () => {
  it('takes a new name without changing the slug, or a new slug', () => {
    expect(brandUpdateSchema.parse({ name: ' Himalaya Herbals ' })).toEqual({
      name: 'Himalaya Herbals',
    });
    expect(brandUpdateSchema.parse({ slug: 'himalaya-herbals' })).toEqual({
      slug: 'himalaya-herbals',
    });
  });

  it('refuses a change that changes nothing', () => {
    expect(brandUpdateSchema.safeParse({}).success).toBe(false);
    expect(brandUpdateSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});
