import { json } from './fake-api';

// Categories and products as the staff catalog API answers them.

const at = '2026-11-01T09:00:00.000Z';

export const HAIR = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Hair Care',
  slug: 'hair-care',
  description: null,
  isActive: true,
  position: 0,
  parentId: null,
  createdAt: at,
  updatedAt: at,
};

export const SKIN = {
  ...HAIR,
  id: '0b8f3a52-6d1e-4c7a-9f2b-3e4d5c6b7a81',
  name: 'Skin Care',
  slug: 'skin-care',
  isActive: false,
  position: 1,
};

// A draft with nothing but its name.
export const OIL = {
  id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
  categoryId: HAIR.id,
  otherCategoryIds: [] as string[],
  brandId: null as string | null,
  name: 'Bhringraj Oil',
  slug: 'bhringraj-oil',
  summary: null,
  description: null,
  ingredients: null,
  usage: null,
  type: null,
  licenceNumber: null,
  manufacturerName: null,
  manufacturerAddress: null,
  countryOfOrigin: 'India',
  hsnCode: null,
  gstRate: null,
  isActive: false,
  position: 0,
  createdAt: at,
  updatedAt: at,
};

// Live, with every detail.
export const SHAMPOO = {
  ...OIL,
  id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a',
  name: 'Amla Shampoo',
  slug: 'amla-shampoo',
  summary: 'A gentle amla shampoo',
  ingredients: 'Amla, reetha, shikakai',
  type: 'COSMETIC',
  licenceNumber: 'MH/25/123',
  manufacturerName: 'Green Leaf Herbals',
  manufacturerAddress: '12 Market Road, Pune',
  hsnCode: '3305',
  gstRate: 18,
  isActive: true,
  position: 1,
};

export const SOAP = {
  ...SHAMPOO,
  id: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
  categoryId: SKIN.id,
  otherCategoryIds: [] as string[],
  brandId: null as string | null,
  name: 'Neem Soap',
  slug: 'neem-soap',
  hsnCode: '3401',
  position: 0,
};

export const CATEGORIES = 'GET /v1/staff/categories';
export const ALL_PRODUCTS = 'GET /v1/staff/products?limit=100';
// Every product shown in a category, its own and those also shown there
// (part 15A): what the list of one category reads.
export const SHOWN_IN = (category: { id: string }) =>
  `GET /v1/staff/products/order?categoryId=${category.id}`;
export const PRODUCT = (product: { id: string }) =>
  `GET /v1/staff/products/${product.id}`;
export const PATCH_PRODUCT = (product: { id: string }) =>
  `PATCH /v1/staff/products/${product.id}`;

export const categoriesOf = (categories: unknown[]) => () =>
  json(200, { categories });

// Brands as the staff list gives them (part 15A).
export const BRANDS = 'GET /v1/staff/brands';
export const HIMALAYA = {
  id: '3f6c1a2e-9b4d-4c7e-8a15-6d2f0e9b7c41',
  name: 'Himalaya',
  slug: 'himalaya',
  createdAt: at,
  updatedAt: at,
  productCount: 1,
};
export const brandsOf = (brands: unknown[]) => () => json(200, { brands });
export const productsOf =
  (products: unknown[], nextAfter: string | null = null) =>
  () =>
    json(200, { products, nextAfter });
export const fieldsRefused = (errors: { field: string; message: string }[]) =>
  json(400, { message: 'Validation failed', errors });

// Pack sizes of the live product, as the API lists them.
export const ML_100 = {
  id: '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d',
  productId: SHAMPOO.id,
  sku: 'AML-SHA-100',
  quantity: 100,
  unit: 'ML',
  mrpRupees: 250,
  priceRupees: 225,
  isActive: true,
  lowStockAt: 10,
  position: 0,
  createdAt: at,
  updatedAt: at,
};

export const ML_200 = {
  ...ML_100,
  id: '7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e',
  sku: 'AML-SHA-200',
  quantity: 200,
  mrpRupees: 450,
  priceRupees: 450,
  position: 1,
};

// Off sale.
export const ML_500 = {
  ...ML_100,
  id: '8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f',
  sku: 'AML-SHA-500',
  quantity: 500,
  mrpRupees: 1000,
  priceRupees: 899,
  isActive: false,
  position: 2,
};

export const VARIANTS = (product: { id: string }) =>
  `GET /v1/staff/products/${product.id}/variants`;
export const variantsOf = (variants: unknown[]) => () =>
  json(200, { variants });

// Images of the live product, as the API lists them: the main photo first.
// The side view was added first, the back view last.
const media = 'http://127.0.0.1:3000/media/products';

export const FRONT = {
  id: '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a',
  productId: SHAMPOO.id,
  width: 1600,
  height: 1200,
  altText: 'The bottle, from the front',
  position: 0,
  url: `${media}/1b2c3d4e-large.webp`,
  thumbnailUrl: `${media}/1b2c3d4e-small.webp`,
  createdAt: '2026-11-02T09:00:00.000Z',
  updatedAt: '2026-11-02T09:00:00.000Z',
};

export const SIDE = {
  ...FRONT,
  id: '0e1f2a3b-4c5d-4e6f-9a7b-8c9d0e1f2a3b',
  width: 1200,
  height: 1600,
  altText: null,
  position: 1,
  url: `${media}/2c3d4e5f-large.webp`,
  thumbnailUrl: `${media}/2c3d4e5f-small.webp`,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

export const BACK = {
  ...FRONT,
  id: '1f2a3b4c-5d6e-4f7a-8b8c-9d0e1f2a3b4c',
  altText: null,
  position: 2,
  url: `${media}/3d4e5f6a-large.webp`,
  thumbnailUrl: `${media}/3d4e5f6a-small.webp`,
  createdAt: '2026-11-03T09:00:00.000Z',
  updatedAt: '2026-11-03T09:00:00.000Z',
};

export const IMAGES = (product: { id: string }) =>
  `GET /v1/staff/products/${product.id}/images`;
export const imagesOf = (images: unknown[]) => () => json(200, { images });
