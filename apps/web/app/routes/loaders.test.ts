// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loader as categoryLoader } from './category.tsx';
import { loader as productLoader } from './product.tsx';
import { loader as shopLoader } from './shop.tsx';

// The shop's and a category's loaders, with a stand-in for the API.
const MEDIA = 'http://127.0.0.1:3000/media/products';
const CATEGORIES = {
  categories: [
    { name: 'Wellness', slug: 'wellness', description: null },
    { name: 'Hair Care', slug: 'hair-care', description: 'For the hair' },
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
  it('asks the API for the categories, then for the search in its own names', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/products': () => answer(200, FOUND),
    });
    const page = await shopAt(
      '?q=tulsi&category=wellness&type=cosmetic&min=10&max=900&page=2',
    );
    expect(asked()).toEqual([
      { pathname: '/v1/categories', query: {} },
      {
        pathname: '/v1/products',
        query: {
          q: 'tulsi',
          category: 'wellness',
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
    expect(page.origin).toBe('http://localhost:3001');
  });

  it('leaves out a category no longer on show', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/products': () => answer(200, FOUND),
    });
    const page = await shopAt('?category=old-category');
    expect(page.search.category).toBeUndefined();
    expect(asked()[1]?.query).not.toHaveProperty('category');
  });

  it('never asks what the API would refuse, and passes on what was wrong', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
      '/v1/products': () => answer(200, FOUND),
    });
    const page = await shopAt('?q=a&min=9.5&sort=relevance&page=900');
    expect(asked()[1]?.query).toEqual({ sort: 'name', page: '1', limit: '24' });
    expect(page.problems).toEqual({
      q: 'Type at least 2 characters to search.',
      min: 'Give a price in whole rupees, like 499.',
    });
  });

  it('shows no photo from anywhere but the shop’s media address', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
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
      '/v1/products': () =>
        answer(200, { ...FOUND, products: [{ ...card('x'), inStock: 'yes' }] }),
    });
    expect(await thrownStatus(shopAt(''))).toBe(503);
  });

  it('refuses a photo address that isn’t a web address', async () => {
    apiAnswers({
      '/v1/categories': () => answer(200, CATEGORIES),
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
  const PAGE = {
    category: CATEGORIES.categories[1],
    products: [card('amla-oil'), card('bhringraj-oil')],
    nextAfter: 'bhringraj-oil',
  };

  it('asks for the category’s products, 24 at a time', async () => {
    apiAnswers({
      '/v1/categories/hair-care/products': () => answer(200, PAGE),
    });
    const page = await categoryAt('hair-care');
    expect(asked()).toEqual([
      { pathname: '/v1/categories/hair-care/products', query: { limit: '24' } },
    ]);
    expect(page).toMatchObject({ ...PAGE, after: null });
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
    category: { name: 'Wellness', slug: 'wellness' },
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
});
