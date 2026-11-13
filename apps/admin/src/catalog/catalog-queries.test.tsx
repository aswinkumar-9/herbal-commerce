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
  useProduct,
  useProductPages,
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
