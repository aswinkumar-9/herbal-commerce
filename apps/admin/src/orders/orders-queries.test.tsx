import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { stockKeys } from '../stock/stock-queries';
import { fakeApi } from '../test/fake-api';
import {
  ORDER,
  ORDERS,
  PACKED,
  PAID,
  PAID_LATER,
  REFUND,
  REFUNDS,
  SHIPPED,
  TO_PACK,
  orderOf,
  ordersOf,
  listed,
  refundsOf,
} from '../test/order-fixtures';
import type { Order } from './orders-api';
import {
  REFRESH_MS,
  orderChanged,
  orderKeys,
  useOrder,
  useOrderPages,
  useRefundPages,
  useToPackCount,
} from './orders-queries';

function withCache() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

// How often a query in the cache looks again on its own. The observer's
// option is kept on the query, though its type doesn't say so.
const refreshOf = (queryClient: QueryClient, queryKey: readonly unknown[]) =>
  (
    queryClient.getQueryCache().find({ queryKey, exact: true })?.options as
      { refetchInterval?: unknown } | undefined
  )?.refetchInterval;

describe('the orders data', () => {
  it('reads the orders a page at a time, and looks again every minute', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [ORDERS('?status=PAID&sort=oldest')]: ordersOf([PAID], PAID.id),
      [ORDERS(`?status=PAID&sort=oldest&after=${PAID.id}`)]: ordersOf([
        PAID_LATER,
      ]),
    });
    const { queryClient, wrapper } = withCache();
    const query = { status: 'PAID', sort: 'oldest' } as const;

    const { result } = renderHook(() => useOrderPages(query), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(
      result.current.data?.pages.flatMap((page) =>
        page.orders.map((order) => order.reference),
      ),
    ).toEqual([PAID.reference, PAID_LATER.reference]);
    expect(refreshOf(queryClient, orderKeys.list(query))).toBe(REFRESH_MS);
    expect(REFRESH_MS).toBe(60_000);
    expect(api.unexpected).toEqual([]);
  });

  it('counts the orders to pack, and looks again every minute', async () => {
    setAccessToken('t1');
    fakeApi({ [TO_PACK]: ordersOf([PAID, PAID_LATER]) });
    const { queryClient, wrapper } = withCache();

    const { result } = renderHook(() => useToPackCount(), { wrapper });

    await waitFor(() =>
      expect(result.current.data).toEqual({ count: 2, more: false }),
    );
    expect(refreshOf(queryClient, orderKeys.toPack())).toBe(REFRESH_MS);
  });

  it('reads one order', async () => {
    setAccessToken('t1');
    fakeApi({ [ORDER(PAID)]: orderOf(PAID) });
    const { wrapper } = withCache();

    const { result } = renderHook(() => useOrder(PAID.id), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(PAID));
  });

  it('reads the refunds a page at a time, and looks again every minute', async () => {
    setAccessToken('t1');
    const refund = listed(REFUND, PAID);
    fakeApi({ [REFUNDS('?status=FAILED')]: refundsOf([refund]) });
    const { queryClient, wrapper } = withCache();

    const { result } = renderHook(() => useRefundPages({ status: 'FAILED' }), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.data?.pages[0]?.refunds).toEqual([refund]),
    );
    expect(
      refreshOf(queryClient, orderKeys.refunds({ status: 'FAILED' })),
    ).toBe(REFRESH_MS);
  });
});

describe('an order changed by a step', () => {
  it('shows at once on its page, and the lists, count, refunds and stock are read again', () => {
    const { queryClient } = withCache();
    const lists = orderKeys.list({ status: 'PAID' });
    const refunds = orderKeys.refunds({});
    const other = orderKeys.order(PAID_LATER.id);
    const stock = stockKeys.lines({});
    for (const key of [lists, orderKeys.toPack(), refunds, other, stock]) {
      queryClient.setQueryData(key, { seen: true });
    }
    queryClient.setQueryData(orderKeys.order(PAID.id), PAID);

    orderChanged(queryClient, PACKED as Order);

    expect(queryClient.getQueryData(orderKeys.order(PAID.id))).toEqual(PACKED);
    const stale = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated;
    expect(stale(lists)).toBe(true);
    expect(stale(orderKeys.toPack())).toBe(true);
    expect(stale(refunds)).toBe(true);
    expect(stale(stock)).toBe(true);
    // Another order's page did not change.
    expect(stale(other)).toBe(false);
    expect(stale(orderKeys.order(PAID.id))).toBe(false);
  });

  it('keeps what the server sent, even when it is a later step', () => {
    const { queryClient } = withCache();
    orderChanged(queryClient, SHIPPED as Order);

    expect(queryClient.getQueryData(orderKeys.order(SHIPPED.id))).toEqual(
      SHIPPED,
    );
  });
});
