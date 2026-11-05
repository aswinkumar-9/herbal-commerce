import { imageUpdateSchema } from './images.schemas';

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
