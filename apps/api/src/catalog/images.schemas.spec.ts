import { imageOrderSchema, imageUpdateSchema } from './images.schemas';

// The fields an invalid change is refused for.
function refusedFields(input: object): string[] {
  const result = imageUpdateSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('imageUpdateSchema', () => {
  it('takes a description and a place, trimmed, and drops unknown fields', () => {
    expect(
      imageUpdateSchema.parse({
        altText: '  The back label, with the ingredients ',
        position: 1,
        fileKey: 'b1c2d3e4-0000-4000-8000-000000000000',
      }),
    ).toEqual({ altText: 'The back label, with the ingredients', position: 1 });
  });

  it('clears the description with null or an empty text', () => {
    expect(imageUpdateSchema.parse({ altText: null })).toEqual({ altText: null });
    expect(imageUpdateSchema.parse({ altText: '   ' })).toEqual({ altText: null });
  });

  it('checks the length and the place', () => {
    expect(refusedFields({ altText: 'a'.repeat(150) })).toEqual([]);
    expect(refusedFields({ altText: 'a'.repeat(151) })).toEqual(['altText']);
    expect(refusedFields({ position: 9999 })).toEqual([]);
    expect(refusedFields({ position: -1 })).toEqual(['position']);
    expect(refusedFields({ position: 10_000 })).toEqual(['position']);
    expect(refusedFields({ position: 1.5 })).toEqual(['position']);
  });

  it('refuses a change with nothing in it', () => {
    expect(refusedFields({})).toEqual(['']);
    expect(refusedFields({ fileKey: 'anything' })).toEqual(['']);
  });
});

describe('imageOrderSchema', () => {
  const A = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const B = '8d0f7780-8536-41ef-a55c-f18c2b01bf18';
  const refused = (input: object) => {
    const result = imageOrderSchema.safeParse(input);
    return result.success
      ? []
      : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  };
  const ids = (count: number) =>
    Array.from(
      { length: count },
      (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    );

  it('takes every image, first to last, and drops unknown fields', () => {
    expect(imageOrderSchema.parse({ ids: [B, A], productId: A })).toEqual({ ids: [B, A] });
    expect(refused({ ids: ids(6) })).toEqual([]);
  });

  it('refuses an empty list, a image twice, a bad ID and more than 6', () => {
    expect(refused({ ids: [] })).toEqual([['ids', 'List the images']]);
    expect(refused({ ids: [A, B, A] })).toEqual([['ids', 'List each image once']]);
    expect(refused({ ids: ['main-photo'] })).toEqual([['ids.0', 'Each image by its ID']]);
    expect(refused({ ids: ids(7) })).toEqual([['ids', 'At most 6 images']]);
    expect(refused({})).toEqual([['ids', expect.any(String)]]);
  });
});
