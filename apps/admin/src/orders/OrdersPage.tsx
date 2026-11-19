import {
  ChevronRight,
  PackageCheck,
  Search,
  SearchX,
  ShoppingBag,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { problemMessage } from '../api/problems';
import { EmptyList, ListLoading, LoadFailed } from '../catalog/list-states';
import { rupees } from '../catalog/products/pack-size-form';
import { Button } from '../components/Button';
import { STAGGER, transition } from '../motion';
import { usePageTitle } from '../page-title';
import { momentName } from '../stock/stock-display';
import { ORDER_FILTERS, orderFilter, placeName } from './order-display';
import type { OrderFilter } from './order-display';
import { orderReference } from './orders-api';
import type { OrderSummary } from './orders-api';
import { useOrderPages } from './orders-queries';
import { StatusTag } from './OrderTags';
import { PackBar, PackSeveralDialog } from './PackSeveral';

// Every order (ADR 0037). It opens on the work: paid orders to pack, the
// oldest first, where several can be ticked and marked packed together.
// The chips show the other steps, and a reference a customer quotes finds
// their order whatever its step. Both live in the address, so the list
// comes back as it was. The list looks for new orders every minute.
export function OrdersPage() {
  usePageTitle('Orders');
  const [params, setParams] = useSearchParams();
  const filter = orderFilter(params.get('show'));
  const reference = orderReference(params.get('reference') ?? '');
  const orders = useOrderPages(reference ? { reference } : filter.query);
  const list = orders.data?.pages.flatMap((page) => page.orders) ?? [];
  const [searchText, setSearchText] = useState(reference ?? '');

  // The orders ticked to pack together: only on the To pack list, and only
  // those it still shows (one packed elsewhere leaves it when it refreshes).
  // Not while another list stands in as the To pack list loads.
  const choosing =
    !reference && filter.name === 'to-pack' && !orders.isPlaceholderData;
  const [chosenIds, setChosenIds] = useState<ReadonlySet<string>>(new Set());
  const chosen = choosing
    ? list.filter((order) => chosenIds.has(order.id))
    : [];
  // The dialog packs the orders chosen when it opened, while the list
  // behind it may refresh. Each opening starts afresh.
  const [packing, setPacking] = useState({
    run: 0,
    open: false,
    orders: [] as OrderSummary[],
  });

  function choose(id: string, on: boolean) {
    setChosenIds((now) => {
      const next = new Set(now);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function update(change: (next: URLSearchParams) => void) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        change(next);
        return next;
      },
      { replace: true },
    );
  }

  function show(chosen: OrderFilter) {
    setSearchText('');
    setChosenIds(new Set());
    update((next) => {
      next.delete('reference');
      if (chosen === ORDER_FILTERS[0]) {
        next.delete('show');
      } else {
        next.set('show', chosen.name);
      }
    });
  }

  // A whole reference finds its order at once; an empty box shows the list
  // again.
  function typed(text: string) {
    setSearchText(text);
    const found = orderReference(text);
    if (found && found !== reference) {
      update((next) => next.set('reference', found));
    } else if (!text.trim() && reference) {
      update((next) => next.delete('reference'));
    }
  }

  function clearSearch() {
    setSearchText('');
    update((next) => next.delete('reference'));
  }

  return (
    <section className="max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="mt-1 text-ink-muted">
          Pack, ship and deliver the orders customers have paid for. The list
          looks for new orders every minute.
        </p>
      </header>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[18rem_1fr]">
        <ReferenceSearch text={searchText} onText={typed} />
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium">Show</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {ORDER_FILTERS.map((chip) => {
              const pressed = !reference && chip === filter;
              return (
                <button
                  key={chip.name}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => show(chip)}
                  className={`relative h-11 rounded-full px-4 text-sm font-medium transition-[color,background-color,box-shadow] duration-150 ${
                    pressed
                      ? 'text-primary-strong'
                      : 'border border-line bg-surface text-ink-muted shadow-clay-sm inset-shadow-clay hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  {pressed ? (
                    <motion.span
                      layoutId="order-filter"
                      transition={transition}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border border-primary/50 bg-primary-soft inset-shadow-pressed"
                    />
                  ) : null}
                  <span className="relative">{chip.label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      <p className="mt-4 text-sm text-ink-muted">
        {reference
          ? `The order with the reference ${reference}, whatever its step.`
          : filter.summary}
      </p>

      {choosing && list.length > 0 ? (
        <ChooseAll
          all={chosen.length === list.length}
          some={chosen.length > 0}
          onChange={(on) =>
            setChosenIds(new Set(on ? list.map((order) => order.id) : []))
          }
        />
      ) : null}

      {orders.isPending ? (
        <ListLoading label="Loading the orders…" />
      ) : orders.isError && !orders.data ? (
        <LoadFailed
          title="The orders could not be loaded"
          message={problemMessage(orders.error)}
          retrying={orders.isFetching}
          onRetry={() => void orders.refetch()}
        />
      ) : list.length === 0 ? (
        reference ? (
          <EmptyList
            icon={SearchX}
            title="No order has this reference"
            action={<Button onClick={clearSearch}>Clear the search</Button>}
          >
            Check it with the customer: 10 letters and digits, like 7KQ2M9XDPA.
          </EmptyList>
        ) : (
          <EmptyList
            icon={filter.name === 'to-pack' ? PackageCheck : ShoppingBag}
            title={filter.empty.title}
            action={
              filter.name === 'all' ? null : (
                <Button onClick={() => show(orderFilter('all'))}>
                  Show all orders
                </Button>
              )
            }
          >
            {filter.empty.text}
          </EmptyList>
        )
      ) : (
        <ul
          aria-label="Orders"
          className={`${choosing ? 'mt-2' : 'mt-6'} divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-clay inset-shadow-clay transition-opacity duration-150 ${
            orders.isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          {list.map((order, index) => (
            <motion.li
              key={order.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  ...transition,
                  delay: Math.min(index, 10) * STAGGER,
                },
              }}
            >
              <OrderRow
                order={order}
                withStatus={Boolean(reference) || filter.name === 'all'}
                listSearch={params.toString()}
                choice={
                  choosing
                    ? {
                        chosen: chosenIds.has(order.id),
                        onChange: (on) => choose(order.id, on),
                      }
                    : undefined
                }
              />
            </motion.li>
          ))}
        </ul>
      )}

      {orders.hasNextPage ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          {orders.isFetchNextPageError ? (
            <p role="alert" className="text-sm text-danger">
              More orders could not be loaded. {problemMessage(orders.error)}
            </p>
          ) : null}
          <Button
            onClick={() => void orders.fetchNextPage()}
            busy={orders.isFetchingNextPage}
            busyLabel="Loading…"
          >
            Show more
          </Button>
        </div>
      ) : null}

      <AnimatePresence>
        {chosen.length > 0 ? (
          <PackBar
            key="pack-bar"
            count={chosen.length}
            onClear={() => setChosenIds(new Set())}
            onPack={() =>
              setPacking((now) => ({
                run: now.run + 1,
                open: true,
                orders: chosen,
              }))
            }
          />
        ) : null}
      </AnimatePresence>
      <PackSeveralDialog
        key={packing.run}
        open={packing.open}
        orders={packing.orders}
        onClose={() => setPacking((now) => ({ ...now, open: false }))}
        onFinished={(keep) => setChosenIds(new Set(keep))}
      />
    </section>
  );
}

// Ticks every order the list shows, or none. Half ticked while some are.
function ChooseAll({
  all,
  some,
  onChange,
}: {
  all: boolean;
  some: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 pl-5">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
        <input
          type="checkbox"
          checked={all}
          ref={(box) => {
            if (box) {
              box.indeterminate = some && !all;
            }
          }}
          onChange={(event) => onChange(event.target.checked)}
          className="size-5 cursor-pointer accent-primary"
        />
        Choose all shown
      </label>
      <p className="text-sm text-ink-muted">
        Tick the orders whose boxes are packed to mark them together.
      </p>
    </div>
  );
}

// The box for the reference a customer quotes. Small letters, spaces and
// hyphens are fine: the order is found once all 10 are typed.
function ReferenceSearch({
  text,
  onText,
}: {
  text: string;
  onText: (text: string) => void;
}) {
  const id = useId();
  return (
    <search>
      <label htmlFor={id} className="text-sm font-medium">
        Find an order by its reference
      </label>
      <div className="relative mt-1.5">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
        />
        <input
          id={id}
          type="search"
          value={text}
          onChange={(event) => onText(event.target.value)}
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          className="h-11 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9 font-mono text-ink uppercase inset-shadow-well transition-colors duration-150 outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
        />
      </div>
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-muted">
        10 letters and digits, like 7KQ2M9XDPA.
      </p>
    </search>
  );
}

// One order: its reference, who it goes to and where, when it was placed,
// and its total. The whole row opens it, keeping the list's filters for the
// way back. On the To pack list its box, above the link, ticks it.
function OrderRow({
  order,
  withStatus,
  listSearch,
  choice,
}: {
  order: OrderSummary;
  withStatus: boolean;
  listSearch: string;
  choice: { chosen: boolean; onChange: (on: boolean) => void } | undefined;
}) {
  return (
    <div
      className={`relative flex items-start gap-4 px-4 py-3 transition-colors duration-150 ${
        choice?.chosen ? 'bg-primary-soft/50' : 'hover:bg-surface-muted/40'
      }`}
    >
      {choice ? (
        <label className="relative z-10 -my-2.5 -mr-2 -ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={choice.chosen}
            onChange={(event) => choice.onChange(event.target.checked)}
            className="size-5 cursor-pointer accent-primary"
          />
          <span className="sr-only">Choose {order.reference}</span>
        </label>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={`/orders/${order.id}`}
            state={{ listSearch }}
            className="font-mono font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-inset"
          >
            {order.reference}
            <span className="sr-only">, {order.deliveryName}</span>
          </Link>
          {withStatus ? <StatusTag status={order.status} /> : null}
        </p>
        <p className="mt-1 text-sm">
          {order.deliveryName}
          <span className="text-ink-muted"> · {placeName(order)}</span>
        </p>
        <p className="mt-0.5 text-sm text-ink-muted">
          Placed {momentName(order.createdAt)}
        </p>
      </div>
      <p className="font-medium tabular-nums">{rupees(order.totalRupees)}</p>
      <ChevronRight
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-ink-muted"
      />
    </div>
  );
}
