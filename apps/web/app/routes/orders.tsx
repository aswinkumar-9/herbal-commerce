import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link, useFetcher } from 'react-router';
import { dataOrUnavailable } from '../account.server.ts';
import { getConfig } from '../config.server.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { OUTLINE_PILL, PILL } from '../components/pills.ts';
import {
  UUID,
  dateInIndia,
  listOrders,
  timeInIndia,
} from '../orders.server.ts';
import type { OrderList } from '../orders.server.ts';
import { pageTitle } from '../page-title.ts';
import { rupees } from '../price.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/orders';

// The customer's orders, the newest first (part 14D): what is in each at a
// glance, when it was placed, where it stands and what it came to, each the
// way to its own page. Twenty at a time: "Show more orders" adds the next
// ones in place, or opens them as a page of their own without the page's
// script. Only for a signed-in customer; anyone else signs in first.
const words = text.orders;

type Standing = keyof typeof words.status;

export async function loader({ request, context }: Route.LoaderArgs) {
  // Only an order's ID continues the list; anything else starts it.
  const asked = new URL(request.url).searchParams.get('before');
  const before = asked !== null && UUID.test(asked) ? asked : null;
  const page = dataOrUnavailable(await listOrders(request, context, before));
  const now = Date.now();
  return {
    orders: page.orders.map((order) => shown(order, now)),
    nextBefore: page.nextBefore,
    before,
    origin: getConfig().origin,
  };
}

// An order as the list shows it. One waiting for payment whose time to pay
// is over says so, even before the API has ended it.
function shown(order: OrderList['orders'][number], now: number) {
  const waiting = order.status === 'PENDING_PAYMENT';
  const over = waiting && Date.parse(order.holdExpiresAt) <= now;
  const standing: Standing = over ? 'HOLD_OVER' : order.status;
  return {
    id: order.id,
    reference: order.reference,
    what:
      order.firstProductName === null
        ? text.order.title(order.reference)
        : words.what(order.firstProductName, order.moreProducts),
    placedAt: order.createdAt,
    placedOn: dateInIndia(order.createdAt),
    standing,
    payBy: waiting && !over ? timeInIndia(order.holdExpiresAt) : null,
    totalRupees: order.totalRupees,
  };
}

type Shown = ReturnType<typeof shown>;

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: loaderData.before
          ? `/orders?before=${loaderData.before}`
          : '/orders',
        noindex: true,
      })
    : [];

export default function Orders({ loaderData }: Route.ComponentProps) {
  const { orders, nextBefore, before } = loaderData;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-32 pb-24">
      <header className="flex flex-col gap-2">
        <h1 className="heading-4 text-balance text-ink md:heading-3">
          {words.title}
        </h1>
        {orders.length > 0 ? (
          <p className="body-6 text-ink-muted">{words.intro}</p>
        ) : null}
      </header>
      {orders.length === 0 ? (
        before === null ? (
          <EmptyState title={words.empty} hint={words.emptyHint}>
            <Link prefetch="intent" to="/shop" className={PILL}>
              {words.shop}
            </Link>
          </EmptyState>
        ) : (
          <EmptyState title={words.noMore} />
        )
      ) : (
        // A new list for each later page opened as a page.
        <List key={before ?? ''} first={orders} next={nextBefore} />
      )}
      {before ? (
        <Link
          prefetch="intent"
          to="/orders"
          className={`${OUTLINE_PILL} self-start`}
        >
          {words.start}
        </Link>
      ) : null}
    </div>
  );
}

function List({
  first,
  next,
}: {
  first: readonly Shown[];
  next: string | null;
}) {
  const fetcher = useFetcher<typeof loader>();
  const [batches, setBatches] = useState<(readonly Shown[])[]>([]);
  const [nextBefore, setNextBefore] = useState(next);
  const [seen, setSeen] = useState(fetcher.data);
  if (fetcher.data !== seen) {
    setSeen(fetcher.data);
    if (fetcher.data) {
      setBatches([...batches, fetcher.data.orders]);
      setNextBefore(fetcher.data.nextBefore);
    }
  }
  const list = useRef<HTMLDivElement>(null);

  // The keyboard lands on the first of the orders just added.
  useEffect(() => {
    if (batches.length === 0) {
      return;
    }
    const firsts = list.current?.querySelectorAll('[data-batch-start] a');
    (firsts?.[firsts.length - 1] as HTMLElement | undefined)?.focus();
  }, [batches.length]);

  // Each order once, should one be on two pages; and how many the last
  // "Show more orders" added.
  const orders: Shown[] = [];
  const starts = new Set<number>();
  const known = new Set<string>();
  let added = 0;
  for (const [index, batch] of [first, ...batches].entries()) {
    if (index > 0) {
      starts.add(orders.length);
    }
    added = 0;
    for (const order of batch) {
      if (!known.has(order.id)) {
        known.add(order.id);
        orders.push(order);
        added += 1;
      }
    }
  }

  const loading = fetcher.state !== 'idle';
  const more = nextBefore ? `/orders?before=${nextBefore}` : null;
  const showMore = (event: MouseEvent<HTMLAnchorElement>): void => {
    // Opening it in a new tab still works as a link.
    if (
      !more ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (!loading) {
      void fetcher.load(more);
    }
  };
  return (
    <div
      ref={list}
      aria-busy={loading}
      className="flex flex-col items-start gap-8"
    >
      <ul className="flex w-full flex-col gap-4">
        {orders.map((order, index) => (
          <li
            key={order.id}
            data-batch-start={starts.has(index) ? '' : undefined}
          >
            <OrderCard order={order} />
          </li>
        ))}
      </ul>
      {loading ? <ListSkeleton count={3} /> : null}
      <output className="sr-only">
        {batches.length > 0 ? words.shown(added) : ''}
      </output>
      {more ? (
        // Not prefetched: a click brings the next orders by showMore,
        // never by going to the address (kept for opening a new tab).
        <Link
          prefetch="none"
          to={more}
          onClick={showMore}
          className={OUTLINE_PILL}
        >
          {words.more}
        </Link>
      ) : null}
    </div>
  );
}

// Where an order stands, on a chip: gold while it waits for payment, green
// once paid, quiet once it has ended.
const CHIP = 'caption-3 rounded-full px-3 py-1';
const CHIP_COLOURS: Record<Standing, string> = {
  PENDING_PAYMENT: 'bg-gold text-on-gold',
  HOLD_OVER: 'bg-surface-muted text-ink-muted',
  PAID: 'bg-primary-soft text-primary',
  PACKED: 'bg-primary-soft text-primary',
  SHIPPED: 'bg-primary-soft text-primary',
  DELIVERED: 'bg-primary-soft text-primary',
  CANCELLED: 'bg-surface-muted text-ink-muted',
  EXPIRED: 'bg-surface-muted text-ink-muted',
};

// One order: its link covers the card, so the whole card follows it. The
// link says which order it is to a screen reader, after the words it
// shows (so it can be asked for by voice).
function OrderCard({ order }: { order: Shown }) {
  return (
    <article className="relative flex flex-col gap-3 rounded-3xl bg-surface p-6 transition-transform duration-500 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus hover:-translate-y-0.5 active:scale-98 motion-reduce:hover:translate-y-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="title-3 min-w-0 break-words text-ink">
          <Link
            prefetch="intent"
            to={`/orders/${order.id}`}
            className="after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none"
          >
            {order.what}
            <span className="sr-only">{words.which(order.reference)}</span>
          </Link>
        </h2>
        <p className="body-4 text-ink">{rupees(order.totalRupees)}</p>
      </div>
      {/* Two pieces side by side, one above the other on a narrow phone. */}
      <p className="caption-2 flex flex-wrap gap-x-4 text-ink-muted">
        <time dateTime={order.placedAt}>{words.placed(order.placedOn)}</time>
        <span>{text.order.title(order.reference)}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} ${CHIP_COLOURS[order.standing]}`}>
          {words.status[order.standing]}
        </span>
        {order.payBy ? (
          <span className="caption-2 text-ink-muted">
            {words.payBy(order.payBy)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

// While orders load: shapes like the cards, gently pulsing (still, when
// the device asks for less motion).
function ListSkeleton({ count }: { count: number }) {
  return (
    <ul aria-hidden="true" className="flex w-full flex-col gap-4">
      {Array.from({ length: count }, (_, index) => (
        <li
          key={index}
          data-skeleton
          className="flex flex-col gap-3 rounded-3xl bg-surface p-6 motion-safe:animate-pulse"
        >
          <div className="h-6 w-2/3 rounded-full bg-surface-muted" />
          <div className="h-4 w-1/2 rounded-full bg-surface-muted" />
          <div className="h-6 w-1/4 rounded-full bg-surface-muted" />
        </li>
      ))}
    </ul>
  );
}
