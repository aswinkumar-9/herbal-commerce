import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import { ML_100, ML_200, SHAMPOO } from '../test/catalog-fixtures';
import { fakeApi, json } from '../test/fake-api';
import {
  BATCHES,
  LATER,
  LINES,
  MOVEMENT,
  MOVEMENTS,
  SOON,
  batchesOf,
  stockLine,
} from '../test/stock-fixtures';
import type { BatchList } from './stock-api';
import {
  stockChanged,
  stockKeys,
  useBatches,
  useMovementPages,
  useProductStock,
  useStockPages,
} from './stock-queries';

function withCache() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('the stock data', () => {
  it('reads the Stock page a page at a time, each page asking after the last', async () => {
    setAccessToken('t1');
    const [first, second] = LINES;
    const api = fakeApi({
      'GET /v1/staff/stock?status=low': () =>
        json(200, { lines: [first], nextAfter: ML_100.id }),
      [`GET /v1/staff/stock?status=low&after=${ML_100.id}`]: () =>
        json(200, { lines: [second], nextAfter: null }),
    });
    const { wrapper } = withCache();

    const { result } = renderHook(() => useStockPages({ status: 'low' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(
      result.current.data?.pages.flatMap((page) =>
        page.lines.map((line) => line.variant.sku),
      ),
    ).toEqual(['AML-SHA-100', 'AML-SHA-200']);
    expect(api.unexpected).toEqual([]);
  });

  it("reads a product's pack sizes with their stock, under the Stock page's lists", async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [`GET /v1/staff/stock?productId=${SHAMPOO.id}&limit=100`]: () =>
        json(200, { lines: LINES, nextAfter: null }),
    });
    const { queryClient, wrapper } = withCache();

    const { result } = renderHook(() => useProductStock(SHAMPOO.id), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual(LINES));
    await act(() =>
      queryClient.invalidateQueries({ queryKey: stockKeys.lineLists() }),
    );
    expect(api.sent).toHaveLength(2);
  });

  it('reads batches and movements, and asks nothing for an ID that is not one', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [BATCHES(ML_100)]: batchesOf(ML_100, [SOON, LATER]),
      [MOVEMENTS(LATER)]: () =>
        json(200, { movements: [MOVEMENT], nextBefore: MOVEMENT.id }),
      [`${MOVEMENTS(LATER)}?before=${MOVEMENT.id}`]: () =>
        json(200, { movements: [], nextBefore: null }),
    });
    const { wrapper } = withCache();

    const batches = renderHook(() => useBatches(ML_100.id), { wrapper });
    const moves = renderHook(() => useMovementPages(LATER.id), { wrapper });
    const odd = renderHook(() => useBatches('..'), { wrapper });

    await waitFor(() =>
      expect(batches.result.current.data?.batches).toEqual([SOON, LATER]),
    );
    await waitFor(() => expect(moves.result.current.hasNextPage).toBe(true));
    await act(() => moves.result.current.fetchNextPage());
    await waitFor(() => expect(moves.result.current.hasNextPage).toBe(false));
    await waitFor(() =>
      expect(odd.result.current.error).toEqual(
        new ApiError(404, 'There is no such item.'),
      ),
    );
    expect(api.sent).toHaveLength(3);
    expect(api.unexpected).toEqual([]);
  });
});

describe('a change to stock', () => {
  function cached() {
    const { queryClient } = withCache();
    const list: BatchList = {
      ...(stockLine(ML_100) as Omit<BatchList, 'batches'>),
      batches: [SOON, LATER],
    };
    queryClient.setQueryData(stockKeys.batches(ML_100.id), list);
    queryClient.setQueryData(stockKeys.lines({}), {
      pages: [],
      pageParams: [],
    });
    queryClient.setQueryData(stockKeys.batches(ML_200.id), list);
    return queryClient;
  }

  const numbers = (queryClient: QueryClient) =>
    queryClient
      .getQueryData<BatchList>(stockKeys.batches(ML_100.id))
      ?.batches.map((batch) => batch.batchNumber);

  it('puts a changed batch in place at once, and reads every stock answer again', () => {
    const queryClient = cached();

    stockChanged(queryClient, { ...SOON, quantity: 8 });

    expect(
      queryClient.getQueryData<BatchList>(stockKeys.batches(ML_100.id))
        ?.batches,
    ).toEqual([{ ...SOON, quantity: 8 }, LATER]);
    for (const key of [
      stockKeys.batches(ML_100.id),
      stockKeys.lines({}),
      stockKeys.batches(ML_200.id),
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('puts a new batch where it expires, a corrected one where it now expires', () => {
    const queryClient = cached();

    stockChanged(queryClient, {
      ...LATER,
      id: 'new',
      batchNumber: 'AS2603',
      expiresOn: '2027-09-30',
    });
    expect(numbers(queryClient)).toEqual(['AS2511', 'AS2603', 'AS2610']);

    // The same day: by batch number.
    stockChanged(queryClient, { ...SOON, expiresOn: '2028-09-30' });
    expect(numbers(queryClient)).toEqual(['AS2603', 'AS2511', 'AS2610']);
  });

  it('leaves a pack size whose batches were never read', () => {
    const { queryClient } = withCache();

    stockChanged(queryClient, LATER);

    expect(queryClient.getQueryData(stockKeys.batches(ML_100.id))).toBe(
      undefined,
    );
  });
});
