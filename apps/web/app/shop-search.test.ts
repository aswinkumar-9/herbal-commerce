// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  apiQuery,
  filtersInUse,
  isSlug,
  readShopSearch,
  shopHref,
} from './shop-search.ts';

const read = (query: string) => readShopSearch(new URLSearchParams(query));

describe('reading the shop’s address', () => {
  it('reads words, a category, a type, prices, an order and a page', () => {
    expect(
      read(
        'q=tulsi&category=hair-care&type=cosmetic&min=100&max=500&sort=price-asc&page=2',
      ),
    ).toEqual({
      search: {
        q: 'tulsi',
        category: 'hair-care',
        type: 'cosmetic',
        min: 100,
        max: 500,
        sort: 'price-asc',
        page: 2,
      },
      problems: {},
      typed: { q: 'tulsi', min: '100', max: '500' },
    });
  });

  it('asks for nothing when the address holds nothing', () => {
    expect(read('').search).toEqual({
      q: undefined,
      category: undefined,
      type: undefined,
      min: undefined,
      max: undefined,
      sort: undefined,
      page: 1,
    });
    expect(read('q=&category=&type=&min=&max=&sort=').problems).toEqual({});
  });

  it('makes each run of spaces in the words one, as the API does', () => {
    expect(read('q=%20%20holy%20%20%20basil%20').search.q).toBe('holy basil');
  });

  it('says what is wrong with words too short or too long, and searches without them', () => {
    const short = read('q=a');
    expect(short.search.q).toBeUndefined();
    expect(short.problems.q).toBe('Type at least 2 characters to search.');
    expect(short.typed.q).toBe('a');

    const long = read(`q=${'a'.repeat(101)}`);
    expect(long.search.q).toBeUndefined();
    expect(long.problems.q).toBe('Search with at most 100 characters.');
    expect(read(`q=${'a'.repeat(100)}`).search.q).toHaveLength(100);
    expect(read('q=ab').search.q).toBe('ab');
  });

  it('takes prices in whole rupees only, and says so', () => {
    for (const wrong of ['12.5', '-1', '1e3', 'abc', '1000001', '99999999']) {
      const { search, problems } = read(`min=${wrong}`);
      expect(search.min, wrong).toBeUndefined();
      expect(problems.min, wrong).toBe(
        'Give a price in whole rupees, like 499.',
      );
    }
    expect(read('min=0&max=1000000').search).toMatchObject({
      min: 0,
      max: 1_000_000,
    });
    expect(read('max=x').problems).toEqual({
      max: 'Give a price in whole rupees, like 499.',
    });
  });

  it('drops a range whose highest price is below its lowest, and says so', () => {
    const { search, problems } = read('min=500&max=100');
    expect(search.min).toBeUndefined();
    expect(search.max).toBeUndefined();
    expect(problems.max).toBe('The highest price is below the lowest.');
    expect(read('min=100&max=100').search).toMatchObject({
      min: 100,
      max: 100,
    });
  });

  it('quietly drops a category, type, order or page no customer could have chosen', () => {
    const { search, problems } = read(
      'category=Hair_Care&type=TOYS&sort=newest&page=0',
    );
    expect(search).toMatchObject({
      category: undefined,
      type: undefined,
      sort: undefined,
      page: 1,
    });
    expect(problems).toEqual({});
    expect(read('page=101').search.page).toBe(1);
    expect(read('page=100').search.page).toBe(100);
    expect(read('page=2.5').search.page).toBe(1);
    expect(read(`category=${'a'.repeat(61)}`).search.category).toBeUndefined();
  });

  it('takes only the shop’s own types, never a name every object has', () => {
    for (const sneaky of ['constructor', 'toString', '__proto__']) {
      expect(read(`type=${sneaky}`).search.type, sneaky).toBeUndefined();
    }
    expect(read('type=ayurvedic-medicine').search.type).toBe(
      'ayurvedic-medicine',
    );
  });

  it('keeps an order only when it isn’t the usual one for the words', () => {
    expect(read('q=tulsi&sort=relevance').search.sort).toBeUndefined();
    expect(read('sort=name').search.sort).toBeUndefined();
    expect(read('q=tulsi&sort=name').search.sort).toBe('name');
    // The best match needs words to match.
    expect(read('sort=relevance').search.sort).toBeUndefined();
  });

  it('cuts short what an address holds far too much of', () => {
    const { typed } = read(`q=${'a'.repeat(500)}&min=${'1'.repeat(50)}`);
    expect(typed.q).toHaveLength(200);
    expect(typed.min).toHaveLength(16);
  });
});

describe('asking the API', () => {
  it('asks in the API’s own names, 24 to a page', () => {
    const { search } = read(
      'q=tulsi&category=wellness&type=food-or-supplement&min=0&max=499&page=3',
    );
    expect(Object.fromEntries(apiQuery(search))).toEqual({
      q: 'tulsi',
      category: 'wellness',
      type: 'FOOD_OR_SUPPLEMENT',
      minPriceRupees: '0',
      maxPriceRupees: '499',
      sort: 'relevance',
      page: '3',
      limit: '24',
    });
  });

  it('asks for the order by name when there are no words', () => {
    expect(Object.fromEntries(apiQuery(read('').search))).toEqual({
      sort: 'name',
      page: '1',
      limit: '24',
    });
    expect(apiQuery(read('sort=price-desc').search).get('sort')).toBe(
      'price-desc',
    );
  });
});

describe('the shop’s addresses', () => {
  const { search } = read(
    'q=tulsi&category=wellness&type=cosmetic&min=100&max=500&sort=name&page=4',
  );

  it('keeps every part, and starts again from the first page on any change', () => {
    expect(shopHref(search)).toBe(
      '/shop?q=tulsi&category=wellness&type=cosmetic&min=100&max=500&sort=name',
    );
    expect(shopHref(search, { type: undefined })).toBe(
      '/shop?q=tulsi&category=wellness&min=100&max=500&sort=name',
    );
  });

  it('goes to another page with everything else kept', () => {
    expect(shopHref(search, { page: 5 })).toBe(
      '/shop?q=tulsi&category=wellness&type=cosmetic&min=100&max=500&sort=name&page=5',
    );
  });

  it('is the plain shop when nothing is asked, with no usual order written', () => {
    expect(shopHref(read('').search)).toBe('/shop');
    expect(shopHref(read('q=tulsi&sort=name').search, { q: undefined })).toBe(
      '/shop',
    );
  });

  it('writes words so they stay words', () => {
    expect(shopHref(read('q=a%26b%3Dc').search)).toBe('/shop?q=a%26b%3Dc');
  });

  it('counts the filters in use, a price range as one', () => {
    expect(filtersInUse(search)).toBe(3);
    expect(filtersInUse(read('q=tulsi&max=500').search)).toBe(1);
    expect(filtersInUse(read('q=tulsi').search)).toBe(0);
  });
});

describe('a slug', () => {
  it('has lowercase letters, digits and single hyphens, at most 60', () => {
    expect(isSlug('hair-care')).toBe(true);
    expect(isSlug('a'.repeat(60))).toBe(true);
    for (const wrong of [
      '',
      'Hair',
      'hair--care',
      '-hair',
      'hair/care',
      '../x',
      'a'.repeat(61),
      null,
      undefined,
    ]) {
      expect(isSlug(wrong), String(wrong)).toBe(false);
    }
  });
});
