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
  name: 'Neem Soap',
  slug: 'neem-soap',
  hsnCode: '3401',
  position: 0,
};

export const CATEGORIES = 'GET /v1/staff/categories';
export const ALL_PRODUCTS = 'GET /v1/staff/products?limit=100';
export const PRODUCTS_IN = (category: { id: string }) =>
  `GET /v1/staff/products?categoryId=${category.id}&limit=100`;
export const PRODUCT = (product: { id: string }) =>
  `GET /v1/staff/products/${product.id}`;
export const PATCH_PRODUCT = (product: { id: string }) =>
  `PATCH /v1/staff/products/${product.id}`;

export const categoriesOf = (categories: unknown[]) => () =>
  json(200, { categories });
export const productsOf =
  (products: unknown[], nextAfter: string | null = null) =>
  () =>
    json(200, { products, nextAfter });
export const fieldsRefused = (errors: { field: string; message: string }[]) =>
  json(400, { message: 'Validation failed', errors });
