import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import { fakeApi, json } from '../test/fake-api';
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  getProduct,
  listCategories,
  listProducts,
  reorderCategories,
  reorderProducts,
  updateCategory,
  updateProduct,
} from './catalog-api';

const CATEGORY_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PRODUCT_ID = '0b8f3a52-6d1e-4c7a-9f2b-3e4d5c6b7a81';
const OTHER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const HAIR_CARE = {
  id: CATEGORY_ID,
  name: 'Hair Care',
  slug: 'hair-care',
  description: null,
  isActive: true,
  position: 0,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

const OIL = {
  id: PRODUCT_ID,
  categoryId: CATEGORY_ID,
  name: 'Bhringraj Hair Oil',
  slug: 'bhringraj-hair-oil',
  summary: null,
  description: null,
  ingredients: 'Bhringraj, sesame oil',
  usage: null,
  type: 'AYURVEDIC_MEDICINE',
  licenceNumber: '25D/123/2015',
  manufacturerName: 'Herbal Works',
  manufacturerAddress: 'Plot 4, Pune',
  countryOfOrigin: 'India',
  hsnCode: '300490',
  gstRate: 5,
  isActive: false,
  position: 0,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

function signedIn() {
  setAccessToken('t1');
}

describe('the categories', () => {
  it('lists them with the access token', async () => {
    signedIn();
    const api = fakeApi({
      'GET /v1/staff/categories': () => json(200, { categories: [HAIR_CARE] }),
    });

    await expect(listCategories()).resolves.toEqual([HAIR_CARE]);
    expect(api.sent[0]?.authorization).toBe('Bearer t1');
  });

  it('creates, changes and deletes one', async () => {
    signedIn();
    const api = fakeApi({
      'POST /v1/staff/categories': () => json(201, HAIR_CARE),
      [`PATCH /v1/staff/categories/${CATEGORY_ID}`]: () =>
        json(200, { ...HAIR_CARE, isActive: false }),
      [`DELETE /v1/staff/categories/${CATEGORY_ID}`]: () =>
        new Response(null, { status: 204 }),
    });

    await expect(
      createCategory({ name: 'Hair Care', description: null }),
    ).resolves.toEqual(HAIR_CARE);
    await expect(
      updateCategory(CATEGORY_ID, { isActive: false }),
    ).resolves.toMatchObject({ isActive: false });
    await expect(deleteCategory(CATEGORY_ID)).resolves.toBeUndefined();

    expect(api.sent.map((request) => request.body)).toEqual([
      { name: 'Hair Care', description: null },
      { isActive: false },
      undefined,
    ]);
  });

  it('sends a new order, every category first to last', async () => {
    signedIn();
    const api = fakeApi({
      'PUT /v1/staff/categories/order': () =>
        json(200, { categories: [HAIR_CARE] }),
    });

    await expect(reorderCategories([OTHER_ID, CATEGORY_ID])).resolves.toEqual([
      HAIR_CARE,
    ]);
    expect(api.sent[0]?.body).toEqual({ ids: [OTHER_ID, CATEGORY_ID] });
  });

  it('turns an answer of the wrong shape into an error', async () => {
    signedIn();
    fakeApi({
      'GET /v1/staff/categories': () =>
        json(200, { categories: [{ ...HAIR_CARE, isActive: 'yes' }] }),
    });

    await expect(listCategories()).rejects.toThrow(
      'The server sent an answer the console does not understand.',
    );
  });
});

describe('the products', () => {
  it('asks for a page with only the filters given', async () => {
    signedIn();
    const api = fakeApi({
      'GET /v1/staff/products': () =>
        json(200, { products: [OIL], nextAfter: PRODUCT_ID }),
      [`GET /v1/staff/products?categoryId=${CATEGORY_ID}&isActive=false&q=hair+oil&after=${PRODUCT_ID}&limit=25`]:
        () => json(200, { products: [], nextAfter: null }),
    });

    await expect(listProducts({})).resolves.toEqual({
      products: [OIL],
      nextAfter: PRODUCT_ID,
    });
    await listProducts({
      categoryId: CATEGORY_ID,
      isActive: false,
      q: 'hair oil',
      after: PRODUCT_ID,
      limit: 25,
    });

    expect(api.unexpected).toEqual([]);
  });

  it('keeps search words to the query string', async () => {
    signedIn();
    const api = fakeApi({
      'GET /v1/staff/products?q=oil%26isActive%3Dtrue%2F..%2F': () =>
        json(200, { products: [], nextAfter: null }),
    });

    await listProducts({ q: 'oil&isActive=true/../' });

    expect(api.unexpected).toEqual([]);
  });

  it('reads, creates, changes and deletes one', async () => {
    signedIn();
    const api = fakeApi({
      [`GET /v1/staff/products/${PRODUCT_ID}`]: () => json(200, OIL),
      'POST /v1/staff/products': () => json(201, OIL),
      [`PATCH /v1/staff/products/${PRODUCT_ID}`]: () =>
        json(200, { ...OIL, name: 'Bhringraj Oil' }),
      [`DELETE /v1/staff/products/${PRODUCT_ID}`]: () =>
        new Response(null, { status: 204 }),
    });

    await expect(getProduct(PRODUCT_ID)).resolves.toEqual(OIL);
    await expect(
      createProduct({ categoryId: CATEGORY_ID, name: 'Bhringraj Hair Oil' }),
    ).resolves.toEqual(OIL);
    await expect(
      updateProduct(PRODUCT_ID, { name: 'Bhringraj Oil' }),
    ).resolves.toMatchObject({ name: 'Bhringraj Oil' });
    await expect(deleteProduct(PRODUCT_ID)).resolves.toBeUndefined();

    expect(api.unexpected).toEqual([]);
    expect(api.sent[1]?.body).toEqual({
      categoryId: CATEGORY_ID,
      name: 'Bhringraj Hair Oil',
    });
  });

  it('sends a category’s new order', async () => {
    signedIn();
    const api = fakeApi({
      'PUT /v1/staff/products/order': () => json(200, { products: [OIL] }),
    });

    await expect(
      reorderProducts(CATEGORY_ID, [PRODUCT_ID, OTHER_ID]),
    ).resolves.toEqual([OIL]);
    expect(api.sent[0]?.body).toEqual({
      categoryId: CATEGORY_ID,
      ids: [PRODUCT_ID, OTHER_ID],
    });
  });

  it('refuses a product type it does not know', async () => {
    signedIn();
    fakeApi({
      [`GET /v1/staff/products/${PRODUCT_ID}`]: () =>
        json(200, { ...OIL, type: 'POTION' }),
    });

    await expect(getProduct(PRODUCT_ID)).rejects.toThrow(
      'The server sent an answer the console does not understand.',
    );
  });
});

describe('an ID from the address bar', () => {
  it.each([
    ['..'],
    ['../../auth/logout'],
    [`${PRODUCT_ID}/../..`],
    [`../${PRODUCT_ID}`],
    [`${PRODUCT_ID}?isActive=true`],
    ['%2e%2e'],
    [''],
  ])('never reaches the path: %j', async (id) => {
    signedIn();
    const api = fakeApi({});

    const reads = [
      getProduct(id),
      updateProduct(id, { name: 'x' }),
      deleteProduct(id),
      updateCategory(id, { name: 'x' }),
      deleteCategory(id),
    ];

    for (const read of reads) {
      await expect(read).rejects.toEqual(
        new ApiError(404, 'There is no such item.'),
      );
    }
    expect(api.sent).toEqual([]);
  });
});
