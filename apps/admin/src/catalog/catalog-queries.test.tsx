import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import { fakeApi, json } from '../test/fake-api';
import {
  catalogKeys,
  useCategories,
  useImages,
  useProduct,
  useProductPages,
  useVariants,
} from './catalog-queries';

const CATEGORY_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const FIRST = '0b8f3a52-6d1e-4c7a-9f2b-3e4d5c6b7a81';
const SECOND = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const product = (id: string, name: string) => ({
  id,
  categoryId: CATEGORY_ID,
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
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
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
});

function withCache() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('the catalog data', () => {
  it('reads the categories once into the cache', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      'GET /v1/staff/categories': () => json(200, { categories: [] }),
    });
    const { queryClient, wrapper } = withCache();

    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(queryClient.getQueryData(catalogKeys.categories())).toEqual([]);
    expect(api.sent).toHaveLength(1);
  });

  it('reads products a page at a time, each page asking after the last', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [`GET /v1/staff/products?categoryId=${CATEGORY_ID}`]: () =>
        json(200, { products: [product(FIRST, 'Hair Oil')], nextAfter: FIRST }),
      [`GET /v1/staff/products?categoryId=${CATEGORY_ID}&after=${FIRST}`]: () =>
        json(200, {
          products: [product(SECOND, 'Hair Wash')],
          nextAfter: null,
        }),
    });
    const { wrapper } = withCache();

    const { result } = renderHook(
      () => useProductPages({ categoryId: CATEGORY_ID }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(
      result.current.data?.pages.flatMap((page) =>
        page.products.map(({ name }) => name),
      ),
    ).toEqual(['Hair Oil', 'Hair Wash']);
    expect(api.unexpected).toEqual([]);
  });

  it('reads one product, and asks nothing for an ID that is not one', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [`GET /v1/staff/products/${FIRST}`]: () =>
        json(200, product(FIRST, 'Hair Oil')),
    });
    const { wrapper } = withCache();

    const found = renderHook(() => useProduct(FIRST), { wrapper });
    const odd = renderHook(() => useProduct('..'), { wrapper });

    await waitFor(() =>
      expect(found.result.current.data?.name).toBe('Hair Oil'),
    );
    await waitFor(() =>
      expect(odd.result.current.error).toEqual(
        new ApiError(404, 'There is no such item.'),
      ),
    );
    expect(api.sent).toHaveLength(1);
  });
});

describe("a product's pack sizes and images", () => {
  const PACK = {
    id: SECOND,
    productId: FIRST,
    sku: 'HAIR-OIL-100',
    quantity: 100,
    unit: 'ML',
    mrpRupees: 350,
    priceRupees: 320,
    isActive: true,
    position: 0,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
  };
  const PHOTO = {
    id: SECOND,
    productId: FIRST,
    width: 1600,
    height: 1600,
    altText: null,
    position: 0,
    url: 'http://127.0.0.1:3000/media/products/a-large.webp',
    thumbnailUrl: 'http://127.0.0.1:3000/media/products/a-small.webp',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
  };

  it('reads each into the cache under its product, and asks nothing for an ID that is not one', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [`GET /v1/staff/products/${FIRST}/variants`]: () =>
        json(200, { variants: [PACK] }),
      [`GET /v1/staff/products/${FIRST}/images`]: () =>
        json(200, { images: [PHOTO] }),
    });
    const { queryClient, wrapper } = withCache();

    const packs = renderHook(() => useVariants(FIRST), { wrapper });
    const photos = renderHook(() => useImages(FIRST), { wrapper });
    const oddPacks = renderHook(() => useVariants('..'), { wrapper });
    const oddPhotos = renderHook(() => useImages('..'), { wrapper });

    await waitFor(() => expect(packs.result.current.data).toEqual([PACK]));
    await waitFor(() => expect(photos.result.current.data).toEqual([PHOTO]));
    await waitFor(() =>
      expect(oddPacks.result.current.error).toEqual(
        new ApiError(404, 'There is no such item.'),
      ),
    );
    await waitFor(() =>
      expect(oddPhotos.result.current.error).toEqual(
        new ApiError(404, 'There is no such item.'),
      ),
    );
    expect(api.sent).toHaveLength(2);

    // Refreshing the product refreshes its pack sizes and images too.
    await act(() =>
      queryClient.invalidateQueries({ queryKey: catalogKeys.product(FIRST) }),
    );
    expect(api.to('GET', `/v1/staff/products/${FIRST}/variants`)).toHaveLength(
      2,
    );
    expect(api.to('GET', `/v1/staff/products/${FIRST}/images`)).toHaveLength(2);
  });
});
