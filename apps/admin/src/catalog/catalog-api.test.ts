import { describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import { fakeApi, json } from '../test/fake-api';
import {
  createCategory,
  createProduct,
  createVariant,
  deleteCategory,
  deleteImage,
  deleteProduct,
  deleteVariant,
  getProduct,
  imageFileProblem,
  listCategories,
  listImages,
  listProducts,
  listVariants,
  nextProductPosition,
  reorderCategories,
  reorderImages,
  reorderProducts,
  reorderVariants,
  updateCategory,
  updateImage,
  updateProduct,
  updateVariant,
  uploadImage,
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

  it('puts a product after the last one of its category, on any page', async () => {
    signedIn();
    const IN = `GET /v1/staff/products?categoryId=${CATEGORY_ID}&limit=100`;
    const api = fakeApi({
      [IN]: () =>
        json(200, {
          products: [OIL, { ...OIL, id: OTHER_ID, position: 7 }],
          nextAfter: OTHER_ID,
        }),
      [`GET /v1/staff/products?categoryId=${CATEGORY_ID}&after=${OTHER_ID}&limit=100`]:
        () =>
          json(200, { products: [{ ...OIL, position: 12 }], nextAfter: null }),
    });

    await expect(nextProductPosition(CATEGORY_ID)).resolves.toBe(13);
    expect(api.sent).toHaveLength(2);
  });

  it('starts an empty category at 0, and never goes past 9999', async () => {
    signedIn();
    const IN = `GET /v1/staff/products?categoryId=${CATEGORY_ID}&limit=100`;
    fakeApi({
      [IN]: [
        () => json(200, { products: [], nextAfter: null }),
        () =>
          json(200, {
            products: [{ ...OIL, position: 9999 }],
            nextAfter: null,
          }),
      ],
    });

    await expect(nextProductPosition(CATEGORY_ID)).resolves.toBe(0);
    await expect(nextProductPosition(CATEGORY_ID)).resolves.toBe(9999);
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
      listVariants(id),
      createVariant(id, PACK_FIELDS),
      updateVariant(id, { isActive: false }),
      deleteVariant(id),
      reorderVariants(id, [PACK_ID]),
      listImages(id),
      uploadImage(id, photo()),
      updateImage(id, { altText: null }),
      deleteImage(id),
      reorderImages(id, [IMAGE_ID]),
    ];

    for (const read of reads) {
      await expect(read).rejects.toEqual(
        new ApiError(404, 'There is no such item.'),
      );
    }
    expect(api.sent).toEqual([]);
  });
});

const PACK_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const IMAGE_ID = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';

const PACK_FIELDS = {
  sku: 'BHR-OIL-100',
  quantity: 100,
  unit: 'ML',
  mrpRupees: 350,
  priceRupees: 320,
  isActive: true,
} as const;

const PACK = {
  ...PACK_FIELDS,
  id: PACK_ID,
  productId: PRODUCT_ID,
  position: 0,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

const PHOTO = {
  id: IMAGE_ID,
  productId: PRODUCT_ID,
  width: 1600,
  height: 1200,
  altText: null,
  position: 0,
  url: `http://127.0.0.1:3000/media/products/${IMAGE_ID}-large.webp`,
  thumbnailUrl: `http://127.0.0.1:3000/media/products/${IMAGE_ID}-small.webp`,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

function photo(
  name = 'oil.jpg',
  type = 'image/jpeg',
  contents: BlobPart = 'jpeg bytes',
) {
  return new File([contents], name, { type });
}

describe('the pack sizes', () => {
  it('lists, adds, changes and deletes them', async () => {
    signedIn();
    const api = fakeApi({
      [`GET /v1/staff/products/${PRODUCT_ID}/variants`]: () =>
        json(200, { variants: [PACK] }),
      [`POST /v1/staff/products/${PRODUCT_ID}/variants`]: () => json(201, PACK),
      [`PATCH /v1/staff/variants/${PACK_ID}`]: () =>
        json(200, { ...PACK, isActive: false }),
      [`DELETE /v1/staff/variants/${PACK_ID}`]: () =>
        new Response(null, { status: 204 }),
    });

    await expect(listVariants(PRODUCT_ID)).resolves.toEqual([PACK]);
    await expect(createVariant(PRODUCT_ID, PACK_FIELDS)).resolves.toEqual(PACK);
    await expect(
      updateVariant(PACK_ID, { isActive: false }),
    ).resolves.toMatchObject({ isActive: false });
    await expect(deleteVariant(PACK_ID)).resolves.toBeUndefined();

    expect(api.sent.map((request) => [request.method, request.body])).toEqual([
      ['GET', undefined],
      ['POST', PACK_FIELDS],
      ['PATCH', { isActive: false }],
      ['DELETE', undefined],
    ]);
    expect(api.sent.every((r) => r.authorization === 'Bearer t1')).toBe(true);
  });

  it('sends a new order, every pack size first to last', async () => {
    signedIn();
    const api = fakeApi({
      [`PUT /v1/staff/products/${PRODUCT_ID}/variants/order`]: () =>
        json(200, { variants: [PACK] }),
    });

    await expect(
      reorderVariants(PRODUCT_ID, [OTHER_ID, PACK_ID]),
    ).resolves.toEqual([PACK]);
    expect(api.sent[0]?.body).toEqual({ ids: [OTHER_ID, PACK_ID] });
  });

  it('refuses a unit it does not know', async () => {
    signedIn();
    fakeApi({
      [`GET /v1/staff/products/${PRODUCT_ID}/variants`]: () =>
        json(200, { variants: [{ ...PACK, unit: 'BOTTLES' }] }),
    });

    await expect(listVariants(PRODUCT_ID)).rejects.toThrow(
      'The server sent an answer the console does not understand.',
    );
  });
});

describe('the images', () => {
  it('lists them, changes a description and deletes one', async () => {
    signedIn();
    const api = fakeApi({
      [`GET /v1/staff/products/${PRODUCT_ID}/images`]: () =>
        json(200, { images: [PHOTO] }),
      [`PATCH /v1/staff/images/${IMAGE_ID}`]: () =>
        json(200, { ...PHOTO, altText: 'The back label' }),
      [`DELETE /v1/staff/images/${IMAGE_ID}`]: () =>
        new Response(null, { status: 204 }),
    });

    await expect(listImages(PRODUCT_ID)).resolves.toEqual([PHOTO]);
    await expect(
      updateImage(IMAGE_ID, { altText: 'The back label' }),
    ).resolves.toMatchObject({ altText: 'The back label' });
    await expect(deleteImage(IMAGE_ID)).resolves.toBeUndefined();

    expect(api.sent.map((request) => request.body)).toEqual([
      undefined,
      { altText: 'The back label' },
      undefined,
    ]);
  });

  it('uploads one, the file itself with its type, and says how much has gone', async () => {
    signedIn();
    const api = fakeApi({
      [`POST /v1/staff/products/${PRODUCT_ID}/images`]: () => json(201, PHOTO),
    });
    const file = photo('oil.png', 'image/png');
    const progress = vi.fn();

    await expect(
      uploadImage(PRODUCT_ID, file, { onProgress: progress }),
    ).resolves.toEqual(PHOTO);

    expect(api.sent[0]?.body).toBe(file);
    expect(new Headers(api.sent[0]?.init.headers).get('Content-Type')).toBe(
      'image/png',
    );
    expect(progress).toHaveBeenLastCalledWith(1);
  });

  it('sends a new order, every image first to last', async () => {
    signedIn();
    const api = fakeApi({
      [`PUT /v1/staff/products/${PRODUCT_ID}/images/order`]: () =>
        json(200, { images: [PHOTO] }),
    });

    await expect(
      reorderImages(PRODUCT_ID, [OTHER_ID, IMAGE_ID]),
    ).resolves.toEqual([PHOTO]);
    expect(api.sent[0]?.body).toEqual({ ids: [OTHER_ID, IMAGE_ID] });
  });

  it.each([
    // oxlint-disable-next-line no-script-url -- checks such an address is refused
    ['javascript:alert(1)'],
    ['data:image/png;base64,AAAA'],
    ['/media/products/x.webp'],
  ])(
    'shows no image from an address that is not http or https: %s',
    async (url) => {
      signedIn();
      fakeApi({
        [`GET /v1/staff/products/${PRODUCT_ID}/images`]: [
          () => json(200, { images: [{ ...PHOTO, url }] }),
          () => json(200, { images: [{ ...PHOTO, thumbnailUrl: url }] }),
        ],
      });

      // The large photo's address, then the small one's.
      await expect(listImages(PRODUCT_ID)).rejects.toThrow(
        'The server sent an answer the console does not understand.',
      );
      await expect(listImages(PRODUCT_ID)).rejects.toThrow(
        'The server sent an answer the console does not understand.',
      );
    },
  );
});

describe('a file to upload', () => {
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  const HEIC = 'HEIC photos cannot be used. Save it as a JPEG first.';
  const NOT_AN_IMAGE = 'Choose a JPEG, PNG or WebP image.';

  it.each([
    ['a JPEG', photo('oil.jpg', 'image/jpeg'), null],
    ['a WebP', photo('oil.webp', 'image/webp'), null],
    [
      'a PNG of exactly 10 MB',
      photo('oil.png', 'image/png', new Uint8Array(10 * 1024 * 1024)),
      null,
    ],
    ['a HEIC photo', photo('IMG_0042.HEIC', 'image/heic'), HEIC],
    // Some browsers give a HEIC file no type at all.
    ['a HEIC photo with no type', photo('IMG_0042.heic', ''), HEIC],
    // And a photo shared from a phone may have no file extension.
    ['a HEIF photo with no extension', photo('IMG_0042', 'image/heif'), HEIC],
    ['a GIF', photo('oil.gif', 'image/gif'), NOT_AN_IMAGE],
    ['an SVG', photo('oil.svg', 'image/svg+xml'), NOT_AN_IMAGE],
    ['a PDF', photo('notes.pdf', 'application/pdf'), NOT_AN_IMAGE],
    ['an empty file', photo('oil.jpg', 'image/jpeg', ''), 'The file is empty.'],
    [
      'a file over 10 MB',
      photo('oil.jpg', 'image/jpeg', big),
      'The file is 10.1 MB. An image may be at most 10 MB.',
    ],
  ])('%s', (_name, file, problem) => {
    expect(imageFileProblem(file)).toBe(problem);
  });

  it('is not sent when the API would refuse it', async () => {
    signedIn();
    const api = fakeApi({});

    await expect(
      uploadImage(PRODUCT_ID, photo('oil.gif', 'image/gif')),
    ).rejects.toEqual(new ApiError(415, NOT_AN_IMAGE));
    await expect(
      uploadImage(PRODUCT_ID, photo('oil.jpg', 'image/jpeg', big)),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      uploadImage(PRODUCT_ID, photo('oil.jpg', 'image/jpeg', '')),
    ).rejects.toMatchObject({ status: 400, message: 'The file is empty.' });
    expect(api.sent).toEqual([]);
  });
});
