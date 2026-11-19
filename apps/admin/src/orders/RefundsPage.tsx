import { ChevronRight, ReceiptIndianRupee, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { problemMessage } from '../api/problems';
import { EmptyList, ListLoading, LoadFailed } from '../catalog/list-states';
import { rupees } from '../catalog/products/pack-size-form';
import { Button } from '../components/Button';
import { STAGGER, transition } from '../motion';
import { usePageTitle } from '../page-title';
import { momentName } from '../stock/stock-display';
import { REFUND_REASON_NAMES } from './order-display';
import type { ListedRefund } from './orders-api';
import { useRefundPages } from './orders-queries';
import { RefundTag } from './OrderTags';

const FAILED = { status: 'FAILED' } as const;
const EVERY = {};

// The refunds, for Super Users only (ADR 0028, ADR 0037): money going back
// to customers through Razorpay. Those Razorpay could not give back come
// first, for a Super User to give back by hand. Each leads to its order.
// Both lists look again every minute.
export function RefundsPage() {
  usePageTitle('Refunds');
  const failed = useRefundPages(FAILED);
  const failedList = failed.data?.pages.flatMap((page) => page.refunds) ?? [];

  return (
    <section className="max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Refunds</h1>
        <p className="mt-1 text-ink-muted">
          Money going back to customers through Razorpay. A refund starts on its
          own when a paid order is cancelled, or when a payment comes that its
          order can’t take.
        </p>
      </header>

      {failed.isError && !failed.data ? (
        <LoadFailed
          title="The failed refunds could not be loaded"
          message={problemMessage(failed.error)}
          retrying={failed.isFetching}
          onRetry={() => void failed.refetch()}
        />
      ) : failedList.length > 0 ? (
        <section
          aria-labelledby="failed-refunds"
          className="mt-6 rounded-card border border-danger/40 bg-danger-soft/40 p-5 shadow-clay inset-shadow-clay"
        >
          <h2
            id="failed-refunds"
            className="flex items-center gap-2 text-lg font-semibold text-danger"
          >
            <TriangleAlert aria-hidden="true" className="size-5" />
            Failed: give these back by hand
          </h2>
          <p className="mt-1 text-sm">
            Razorpay could not give this money back. Give each back by hand in
            the Razorpay dashboard, from the payment named on it, and let the
            customer know.
          </p>
          <RefundList label="Failed refunds" refunds={failedList} />
          <ShowMore pages={failed} label="Show more failed refunds" />
        </section>
      ) : null}

      <EveryRefund />
    </section>
  );
}

function EveryRefund() {
  const every = useRefundPages(EVERY);
  const list = every.data?.pages.flatMap((page) => page.refunds) ?? [];
  return (
    <section aria-labelledby="every-refund" className="mt-8">
      <h2 id="every-refund" className="text-lg font-semibold">
        Every refund
      </h2>
      <p className="mt-1 text-sm text-ink-muted">The newest first.</p>
      {every.isPending ? (
        <ListLoading label="Loading the refunds…" />
      ) : every.isError && !every.data ? (
        <LoadFailed
          title="The refunds could not be loaded"
          message={problemMessage(every.error)}
          retrying={every.isFetching}
          onRetry={() => void every.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyList
          icon={ReceiptIndianRupee}
          title="No refunds yet"
          action={null}
        >
          None has been needed so far.
        </EmptyList>
      ) : (
        <>
          <RefundList label="Every refund" refunds={list} />
          <ShowMore pages={every} label="Show more" />
        </>
      )}
    </section>
  );
}

function RefundList({
  label,
  refunds,
}: {
  label: string;
  refunds: ListedRefund[];
}) {
  return (
    <ul
      aria-label={label}
      className="mt-4 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-clay inset-shadow-clay"
    >
      {refunds.map((refund, index) => (
        <motion.li
          key={refund.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ...transition, delay: Math.min(index, 10) * STAGGER },
          }}
          className="px-4 py-3"
        >
          <RefundRow refund={refund} />
        </motion.li>
      ))}
    </ul>
  );
}

// One refund: how much, where it stands and since when, why it was made,
// Razorpay's IDs to find it in the dashboard, and a link to its order. The
// row is not one big link, so the IDs can be selected and copied.
function RefundRow({ refund }: { refund: ListedRefund }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold tabular-nums">
          {rupees(refund.amountRupees)}
        </span>
        <RefundTag status={refund.status} />
        <span className="text-sm text-ink-muted">
          {momentName(refund.updatedAt)}
        </span>
      </p>
      <p className="mt-1 text-sm">{REFUND_REASON_NAMES[refund.reason]}</p>
      <dl className="mt-1 grid gap-x-3 text-xs text-ink-muted sm:grid-cols-[max-content_1fr]">
        <dt>Started</dt>
        <dd>{momentName(refund.createdAt)}</dd>
        <dt>Razorpay payment</dt>
        <dd className="font-mono break-all">{refund.razorpayPaymentId}</dd>
        {refund.razorpayRefundId ? (
          <>
            <dt>Razorpay refund</dt>
            <dd className="font-mono break-all">{refund.razorpayRefundId}</dd>
          </>
        ) : null}
      </dl>
      <Link
        to={`/orders/${refund.orderId}`}
        state={{ from: 'refunds' }}
        className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        Order <span className="font-mono">{refund.orderReference}</span>
        <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    </>
  );
}

function ShowMore({
  pages,
  label,
}: {
  pages: ReturnType<typeof useRefundPages>;
  label: string;
}) {
  if (!pages.hasNextPage) {
    return null;
  }
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      {pages.isFetchNextPageError ? (
        <p role="alert" className="text-sm text-danger">
          More refunds could not be loaded. {problemMessage(pages.error)}
        </p>
      ) : null}
      <Button
        onClick={() => void pages.fetchNextPage()}
        busy={pages.isFetchingNextPage}
        busyLabel="Loading…"
      >
        {label}
      </Button>
    </div>
  );
}
