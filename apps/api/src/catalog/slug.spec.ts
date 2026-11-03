import { SLUG_MAX, SLUG_PATTERN, slugify } from './slug';

describe('slugify', () => {
  it('makes a lowercase slug with single hyphens from a name', () => {
    const cases: [string, string][] = [
      ['Hair Care', 'hair-care'],
      ['HAIR  care', 'hair-care'],
      ['  Skin & Body  ', 'skin-body'],
      ['Ayurvedic Oils (Cold-pressed)', 'ayurvedic-oils-cold-pressed'],
      ['Teas, Tisanes & Kadha', 'teas-tisanes-kadha'],
      ['100% Natural', '100-natural'],
    ];
    for (const [name, slug] of cases) {
      expect([name, slugify(name)]).toEqual([name, slug]);
    }
  });

  it('drops accents and opens joined letters', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('ﬁne ﬂavours')).toBe('fine-flavours');
  });

  it('gives an empty slug for a name without Latin letters or digits', () => {
    expect(slugify('आयुर्वेद')).toBe('');
    expect(slugify('---')).toBe('');
  });

  it(`stops at ${SLUG_MAX} characters, never ending in a hyphen`, () => {
    const slug = slugify(`${'a'.repeat(59)} b`);
    expect(slug).toBe('a'.repeat(59));
    expect(slugify('x'.repeat(100))).toHaveLength(SLUG_MAX);
  });

  it('always makes something the slug pattern accepts', () => {
    const names = ['Hair Care', 'Café Crème', 'x'.repeat(100), '1 2 3'];
    for (const name of names) {
      expect([name, SLUG_PATTERN.test(slugify(name))]).toEqual([name, true]);
    }
  });
});
