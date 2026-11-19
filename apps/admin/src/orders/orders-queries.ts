import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { stockKeys } from '../stock/stock-queries';
import { countToPack, getOrder, listOrders, listRefunds } from './orders-api';
import type { Order, OrderQuery, RefundQuery } from './orders-api';

// New orders arrive while staff work: the lists and the menu's count look
// again every minute, while the console is in view. TanStack Query pauses
// while the tab is hidden, and these reads are not activity, so they never
// keep a session from its idle sign-out.
export const REFRESH_MS = 60_000;

// Where the console keeps each order answer. A change to an order
// invalidates orderKeys.all, the refunds included, as a cancel may add one.
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => ['orders', 'list'] as const,
  list: (query: Omit<OrderQuery, 'after'>) =>
    ['orders', 'list', query] as const,
  order: (id: string) => ['orders', 'order', id] as const,
  toPack: () => ['orders', 'to-pack'] as const,
  refunds: (query: Omit<RefundQuery, 'after'>) =>
    ['orders', 'refunds', query] as const,
};

// The orders a page at a time: each page's nextAfter asks for the next.
// While another filter loads, the last list stays (isPlaceholderData says
// so).
export function useOrderPages(query: Omit<OrderQuery, 'after'>) {
  return useInfiniteQuery({
    queryKey: orderKeys.list(query),
    queryFn: ({ pageParam, signal }) =>
      listOrders({ ...query, after: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: orderKeys.order(id),
    queryFn: ({ signal }) => getOrder(id, signal),
  });
}

// How many paid orders wait to be packed, for the menu.
export function useToPackCount() {
  return useQuery({
    queryKey: orderKeys.toPack(),
    queryFn: ({ signal }) => countToPack(signal),
    refetchInterval: REFRESH_MS,
  });
}

// Super Users only: the refunds a page at a time.
export function useRefundPages(query: Omit<RefundQuery, 'after'>) {
  return useInfiniteQuery({
    queryKey: orderKeys.refunds(query),
    queryFn: ({ pageParam, signal }) =>
      listRefunds({ ...query, after: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}

// An order as the server now has it, after a step: on its page at once,
// then the lists, the count and the refunds read again, but no other
// order's page. Stock too, as packing, shipping and cancelling move an
// order's packs.
export function orderChanged(queryClient: QueryClient, saved: Order): void {
  ordersChanged(queryClient, [saved]);
}

// Several orders at once, as packing several does: the lists are read
// again once, not once for each.
export function ordersChanged(queryClient: QueryClient, saved: Order[]): void {
  for (const order of saved) {
    queryClient.setQueryData<Order>(orderKeys.order(order.id), order);
  }
  void queryClient.invalidateQueries({
    queryKey: orderKeys.all,
    predicate: (query) => query.queryKey[1] !== 'order',
  });
  void queryClient.invalidateQueries({ queryKey: stockKeys.all });
}
