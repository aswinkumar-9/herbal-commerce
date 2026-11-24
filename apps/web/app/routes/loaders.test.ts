// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loader as categoryLoader } from './category.tsx';
import { loader as policyLoader } from './policy.tsx';
import { loader as productLoader } from './product.tsx';
import { loader as shopLoader } from './shop.tsx';

// The shop's and a category's loaders, with a stand-in for the API.
const MEDIA = 'http://127.0.0.1:3000/media/products';
const CATEGORIES = {
  categories: [
    {
      name: 'Wellness',
      slug: 'wellness',
      description: null,
      subcategories: [],
    },
    {
      name: 'Hair Care',
      slug: 'hair-care',
      description: 'For the hair',
      subcategories: [
        { name: 'Hair Oils', slug: 'hair-oils', description: null },
      ],
    },
  ],
};
const BRANDS = {
  brands: [
    { name: 'Dabur', slug: 'dabur' },
    { name: 'Himalaya', slug: 'himalaya' },
  ],
};
const card = (
  slug: string,
  imageUrl: string | null = `${MEDIA}/${slug}-small.webp`,
) => ({
  name: slug,
  slug,
  summary: null,
  fromPriceRupees: 299,
  imageUrl,
});
const FOUND = {
  products: [{ ...card('tulsi-drops'), inStock: true }],
  total: 1,
  page: 1,
  nextPage: null,
};

const fetchMock = vi.fn<typeof fetch>();
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
// What each address of the API answers.
function apiAnswers(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url) => {
    const { pathname } = new URL(String(url));
    return (routes[pathname] ?? (() => answer(404, { message: 'x' })))();
  });
}
const asked = () =>
  fetchMock.mock.calls.map(([url]) => {
    const { pathname, searchParams } = new URL(String(url));
    return { pathname, query: Object.fromEntries(searchParams) };
  });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const shopAt = (query: string) =>
  shopLoader({
    request: new Request(`http://localhost:3001/shop${query}`),
    params: {},
    context: undefined,
  } as unknown as Parameters<typeof shopLoader>[0]);
const categoryAt = (slug: string, query = '') =>
  categoryLoader({
    request: new Request(`http://localhost:3001/categories/${slug}${query}`),
    params: { slug },
    context: undefined,
  } as unknown as Parameters<typeof categoryLoader>[0]);

async function thrownStatus(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    return (error as { init: ResponseInit | null }).init?.status ?? 0;
  }
  throw new Error('nothing was thrown');
}

describe('the shop’s loader', () => {
  it('asks the API for the categories and brands, then for the search in its own names', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/brands': () => answer(200, BRANDS),
      '/v1/products': () => answer(200, FOUND),
    });
    const page = await shopAt(
      '?q=tulsi&category=wellness&brand=himalaya&type=cosmetic&min=10&max=900&page=2',
    );
    expect(asked()).toEqual([
      { pathname: '/v1/categories', query: {} },
      { pathname: '/v1/brands', query: {} },
      {
        pathname: '/v1/products',
        query: {
          q: 'tulsi',
          category: 'wellness',
          brand: 'himalaya',
          type: 'COSMETIC',
          minPriceRupees: '10',
          maxPriceRupees: '900',
          sort: 'relevance',
          page: '2',
          limit: '24',
        },
      },
    ]);
    expect(page.found).toEqual(FOUND);
    expect(page.categories).toEqual(CATEGORIES.categories);
    expect(page.brands).toEqual(BRANDS.brands);
    expect(page.origin).toBe('http://localhost:3001');
  });

  it('leaves out a category or brand no longer on show', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/brands': () => answer(200, BRANDS),
      '/v1/products': () => answer(200, FOUND),
    });
    const page = await shopAt('?category=old-category&brand=old-brand');
    expect(page.search.category).toBeUndefined();
    expect(page.search.brand).toBeUndefined();
    expect(asked()[2]?.query).not.toHaveProperty('category');
    expect(asked()[2]?.query).not.toHaveProperty('brand');
  });

  it('filters by a subcategory on show (part 15B)', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/brands': () => answer(200, BRANDS),
      '/v1/products': () => answer(200, FOUND),
    });
    const page = await shopAt('?category=hair-oils');
    expect(page.search.category).toBe('hair-oils');
    expect(asked()[2]?.query).toMatchObject({ category: 'hair-oils' });
  });

  it('says the shop is taking a break when the brands’ answer is not as expected', async () => {
    for (const odd of [{ name: 'Dabur' }, { name: 'Dabur', slug: '../x' }]) {
      apiAnswers({
        '/v1/categories': () => answer(200, CATEGORIES),
        '/v1/brands': () => answer(200, { brands: [odd] }),
        '/v1/products': () => answer(200, FOUND),
      });
      expect(await thrownStatus(shopAt('')), JSON.stringify(odd)).toBe(503);
    }
  });

  it('never asks what the API would refuse, and passes on what was wrong', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/brands': () => answer(200, BRANDS),
      '/v1/products': () => answer(200, FOUND),
    });
    const page = await shopAt('?q=a&min=9.5&sort=relevance&page=900');
    expect(asked()[2]?.query).toEqual({ sort: 'name', page: '1', limit: '24' });
    expect(page.problems).toEqual({
      q: 'Type at least 2 characters to search.',
      min: 'Give a price in whole rupees, like 499.',
    });
  });

  it('shows no photo from anywhere but the shop’s media address', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/brands': () => answer(200, BRANDS),
      '/v1/products': () =>
        answer(200, {
          ...FOUND,
          total: 4,
          products: [
            { ...card('own'), inStock: true },
            {
              ...card('elsewhere', 'https://evil.example.com/x.webp'),
              inStock: true,
            },
            { ...card('climbs', `${MEDIA}/../../secret.webp`), inStock: true },
            { ...card('none', null), inStock: false },
          ],
        }),
    });
    const { found } = await shopAt('');
    expect(found.products.map((product) => product.imageUrl)).toEqual([
      `${MEDIA}/own-small.webp`,
      null,
      null,
      null,
    ]);
  });

  it('says the shop is taking a break when the search’s answer is not as expected', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/brands': () => answer(200, BRANDS),
      '/v1/products': () =>
        answer(200, { ...FOUND, products: [{ ...card('x'), inStock: 'yes' }] }),
    });
    expect(await thrownStatus(shopAt(''))).toBe(503);
  });

  it('refuses a photo address that isn’t a web address', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/brands': () => answer(200, BRANDS),
      '/v1/products': () =>
        answer(200, {
          ...FOUND,
          // oxlint-disable-next-line no-script-url -- checks such an address is refused
          products: [{ ...card('x', 'javascript:alert(1)'), inStock: true }],
        }),
    });
    expect(await thrownStatus(shopAt(''))).toBe(503);
  });
});

describe('a category’s loader', () => {
  const HAIR = {
    name: 'Hair Care',
    slug: 'hair-care',
    description: 'For the hair',
  };
  const PAGE = {
    category: { ...HAIR, parent: null, subcategories: [] },
    products: [card('amla-oil'), card('bhringraj-oil')],
    nextAfter: 'bhringraj-oil',
  };
  // Hair Care with three subcategories (part 15B).
  const sub = (slug: string) => ({
    name: slug,
    slug,
    description: null,
  });
  const TOP = {
    ...PAGE,
    category: {
      ...PAGE.category,
      subcategories: [sub('hair-oils'), sub('hair-powders'), sub('combs')],
    },
  };
  const subPage = (slug: string, products: ReturnType<typeof card>[]) => ({
    category: {
      ...sub(slug),
      parent: { name: HAIR.name, slug: HAIR.slug },
      subcategories: [],
    },
    products,
    nextAfter: null,
  });

  it('asks for the category’s products, 24 at a time', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () => answer(200, PAGE),
    });
    const page = await categoryAt('hair-care');
    expect(asked()).toEqual([
      { pathname: '/v1/categories/hair-care/products', query: { limit: '24' } },
    ]);
    expect(page).toMatchObject({ ...PAGE, previews: [], after: null });
  });

  it('asks for the first few of each subcategory’s products too, at once (part 15B)', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () => answer(200, TOP),
      '/v1/categories/hair-oils/products': () =>
        answer(200, subPage('hair-oils', [card('bhringraj-oil')])),
      '/v1/categories/hair-powders/products': () =>
        answer(
          200,
          subPage('hair-powders', [
            card('amla-powder'),
            card('elsewhere', 'https://evil.example.com/x.webp'),
          ]),
        ),
      '/v1/categories/combs/products': () =>
        answer(200, subPage('combs', [card('neem-comb')])),
    });
    const page = await categoryAt('hair-care');
    expect(asked()).toEqual([
      { pathname: '/v1/categories/hair-care/products', query: { limit: '24' } },
      { pathname: '/v1/categories/hair-oils/products', query: { limit: '4' } },
      {
        pathname: '/v1/categories/hair-powders/products',
        query: { limit: '4' },
      },
      { pathname: '/v1/categories/combs/products', query: { limit: '4' } },
    ]);
    // In the order staff chose, each with its own products only; and no
    // photo from anywhere but the shop's media address.
    expect(page.previews).toEqual([
      { category: sub('hair-oils'), products: [card('bhringraj-oil')] },
      {
        category: sub('hair-powders'),
        products: [card('amla-powder'), card('elsewhere', null)],
      },
      { category: sub('combs'), products: [card('neem-comb')] },
    ]);
  });

  it('leaves out a subcategory hidden or emptied meanwhile', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () => answer(200, TOP),
      '/v1/categories/hair-oils/products': () =>
        answer(200, subPage('hair-oils', [])),
      '/v1/categories/combs/products': () =>
        answer(200, subPage('combs', [card('neem-comb')])),
    });
    const page = await categoryAt('hair-care');
    expect(page.previews.map((preview) => preview.category.slug)).toEqual([
      'combs',
    ]);
  });

  it('asks only for its own products on a later page', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () => answer(200, TOP),
    });
    const page = await categoryAt('hair-care', '?after=amla-oil');
    expect(asked()).toHaveLength(1);
    expect(page.previews).toEqual([]);
  });

  it('says the shop is taking a break when a subcategory’s answer is not as expected', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () => answer(200, TOP),
      '/v1/categories/hair-oils/products': () => answer(200, { products: [] }),
    });
    expect(await thrownStatus(categoryAt('hair-care'))).toBe(503);
  });

  it('asks for the ones after a product, when the address names one', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () => answer(200, PAGE),
    });
    const page = await categoryAt('hair-care', '?after=amla-oil');
    expect(asked()[0]?.query).toEqual({ limit: '24', after: 'amla-oil' });
    expect(page.after).toBe('amla-oil');
  });

  it('shows no photo from anywhere but the shop’s media address', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () =>
        answer(200, {
          ...PAGE,
          products: [
            card('amla-oil'),
            card('elsewhere', 'https://evil.example.com/x.webp'),
          ],
        }),
    });
    const page = await categoryAt('hair-care');
    expect(page.products.map((product) => product.imageUrl)).toEqual([
      `${MEDIA}/amla-oil-small.webp`,
      null,
    ]);
  });

  it('ignores an "after" no product could have', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () => answer(200, PAGE),
    });
    await categoryAt('hair-care', '?after=..%2Fx');
    expect(asked()[0]?.query).toEqual({ limit: '24' });
  });

  it('is "not found" for an address no category could have, without asking the API', async () => {
    for (const slug of ['Hair', 'hair care', '..', 'a'.repeat(61)]) {
      expect(await thrownStatus(categoryAt(slug)), slug).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is "not found" when the API knows no such category', async () => {
    apiAnswers({});
    expect(await thrownStatus(categoryAt('old-category'))).toBe(404);
  });
});

describe('a product’s loader', () => {
  const image = (key: string, at = MEDIA) => ({
    url: `${at}/${key}-large.webp`,
    thumbnailUrl: `${at}/${key}-small.webp`,
    altText: key,
    width: 1200,
    height: 1600,
  });
  const PRODUCT = {
    name: 'Ashwagandha Capsules',
    slug: 'ashwagandha-capsules',
    summary: 'For calm and strength',
    description: null,
    ingredients: 'Ashwagandha root extract 500 mg',
    usage: null,
    type: 'AYURVEDIC_MEDICINE',
    licenceNumber: '25D/123/2015',
    manufacturerName: 'Herbal Works Pvt Ltd',
    manufacturerAddress: '12, Industrial Area, Mysuru 570016',
    countryOfOrigin: 'India',
    category: { name: 'Wellness', slug: 'wellness', parent: null },
    brand: null,
    variants: [
      {
        sku: 'ASH-60',
        quantity: 60,
        unit: 'CAPSULES',
        mrpRupees: 500,
        priceRupees: 400,
        inStock: true,
      },
    ],
    images: [image('front'), image('back')],
  };
  const productAt = (slug: string, query = '') =>
    productLoader({
      request: new Request(`http://localhost:3001/products/${slug}${query}`),
      params: { slug },
      context: undefined,
    } as unknown as Parameters<typeof productLoader>[0]);

  it('asks the API for the product, and shows the first photo first', async () => {
    apiAnswers({
      '/v1/products/ashwagandha-capsules': () => answer(200, PRODUCT),
    });
    const page = await productAt('ashwagandha-capsules');
    expect(asked()).toEqual([
      { pathname: '/v1/products/ashwagandha-capsules', query: {} },
    ]);
    expect(page.product).toEqual(PRODUCT);
    expect(page.photo).toBe(0);
    expect(page.origin).toBe('http://localhost:3001');
  });

  it('shows the photo the address names, when there is one', async () => {
    apiAnswers({
      '/v1/products/ashwagandha-capsules': () => answer(200, PRODUCT),
    });
    expect((await productAt('ashwagandha-capsules', '?photo=2')).photo).toBe(1);
    for (const wrong of ['3', '0', '-1', 'x', '1.5', '999']) {
      expect(
        (await productAt('ashwagandha-capsules', `?photo=${wrong}`)).photo,
        wrong,
      ).toBe(0);
    }
  });

  it('leaves out a photo whose files are not both at the media address', async () => {
    apiAnswers({
      '/v1/products/ashwagandha-capsules': () =>
        answer(200, {
          ...PRODUCT,
          images: [
            image('front'),
            image('elsewhere', 'https://evil.example.com'),
            {
              ...image('half'),
              thumbnailUrl: 'https://evil.example.com/x.webp',
            },
            { ...image('climbs'), url: `${MEDIA}/../../x-large.webp` },
          ],
        }),
    });
    const { product } = await productAt('ashwagandha-capsules');
    expect(product.images.map((each) => each.altText)).toEqual(['front']);
  });

  it('is "not found" for an address no product could have, without asking the API', async () => {
    for (const slug of ['Tulsi', 'tulsi drops', '..', 'a'.repeat(61)]) {
      expect(await thrownStatus(productAt(slug)), slug).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is "not found" when the API has no such product on show', async () => {
    apiAnswers({});
    expect(await thrownStatus(productAt('old-product'))).toBe(404);
  });

  it('says the shop is taking a break when the answer is not as expected', async () => {
    apiAnswers({
      '/v1/products/ashwagandha-capsules': () =>
        answer(200, {
          ...PRODUCT,
          variants: [{ ...PRODUCT.variants[0], unit: 'BOTTLES' }],
        }),
    });
    expect(await thrownStatus(productAt('ashwagandha-capsules'))).toBe(503);
  });

  it('gives its brand, and refuses one not as expected (part 15B)', async () => {
    const brand = { name: 'Himalaya', slug: 'himalaya' };
    apiAnswers({
      '/v1/products/ashwagandha-capsules': () =>
        answer(200, { ...PRODUCT, brand }),
    });
    expect((await productAt('ashwagandha-capsules')).product.brand).toEqual(
      brand,
    );
    for (const odd of [{ name: 'Himalaya' }, { ...brand, slug: '../x' }]) {
      apiAnswers({
        '/v1/products/ashwagandha-capsules': () =>
          answer(200, { ...PRODUCT, brand: odd }),
      });
      expect(
        await thrownStatus(productAt('ashwagandha-capsules')),
        JSON.stringify(odd),
      ).toBe(503);
    }
  });
});

describe('a policy page’s loader', () => {
  const policyAt = (page: string) =>
    policyLoader({
      request: new Request(`http://localhost:3001/${page}`),
      params: { page },
      context: undefined,
    } as unknown as Parameters<typeof policyLoader>[0]);
  const PRIVACY = {
    page: 'privacy',
    version: 3,
    body: '## Who we are\n\nA shop.',
    // 00:30 on 22 Nov 2026 in India, while it is still the 21st in UTC: the
    // day shown is India's.
    publishedAt: '2026-11-21T19:00:00.000Z',
  };

  it('asks the API for the page, and gives its text with the day in India', async () => {
    apiAnswers({ '/v1/policies/privacy': () => answer(200, PRIVACY) });

    const page = await policyAt('privacy');

    expect(page).toMatchObject({
      page: 'privacy',
      policy: {
        body: PRIVACY.body,
        publishedAt: PRIVACY.publishedAt,
        publishedOn: '22 November 2026',
      },
    });
    expect(asked()).toEqual([{ pathname: '/v1/policies/privacy', query: {} }]);
  });

  it('gives no text for a page not published yet, rather than "not found"', async () => {
    apiAnswers({});

    const page = await policyAt('terms');

    expect(page).toMatchObject({ page: 'terms', policy: null });
  });

  it('is "not found" for any other word, without asking the API', async () => {
    for (const word of ['cookies', 'Privacy', 'constructor', '__proto__']) {
      expect(await thrownStatus(policyAt(word))).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the shop is taking a break when the API is busy, or the answer is odd', async () => {
    apiAnswers({ '/v1/policies/privacy': () => answer(503, { message: 'x' }) });
    expect(await thrownStatus(policyAt('privacy'))).toBe(503);
    for (const odd of [
      { ...PRIVACY, page: 'cookies' },
      { ...PRIVACY, body: '' },
      { ...PRIVACY, publishedAt: 'yesterday' },
      { ...PRIVACY, body: 'x'.repeat(30_001) },
    ]) {
      apiAnswers({ '/v1/policies/privacy': () => answer(200, odd) });
      expect(await thrownStatus(policyAt('privacy'))).toBe(503);
    }
  });
});
