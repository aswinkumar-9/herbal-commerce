import {
  ArrowLeft,
  ArrowUpDown,
  ChevronDown,
  ClipboardCheck,
  History,
  PackagePlus,
  PenLine,
  SearchX,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/api-error';
import { problemMessage } from '../api/problems';
import { EmptyList, ListLoading, LoadFailed } from '../catalog/list-states';
import { packName } from '../catalog/products/pack-size-form';
import { Button, buttonClass } from '../components/Button';
import { useListSearch } from '../list-search';
import { DURATION, EASE_OUT, transition } from '../motion';
import { usePageTitle } from '../page-title';
import { batchState, isEmpty } from './batch-forms';
import type { BatchState } from './batch-forms';
import {
  ChangeDialog,
  CountDialog,
  LabelDialog,
  ReceiveDialog,
} from './BatchDialogs';
import type { Batch, BatchList } from './stock-api';
import {
  REASON_NAMES,
  dayName,
  momentName,
  packs,
  signed,
  stockCounts,
} from './stock-display';
import { useBatches, useMovementPages } from './stock-queries';
import { useNow } from './use-now';
import { LevelTag, Tag } from './StockTags';

type DialogKind = 'receive' | 'label' | 'change' | 'count';

// A pack size's stock, batch by batch (ADR 0024, 0034): /stock/:variantId.
// Staff receive deliveries, correct labels, add or write off packs, count
// a shelf, and read each batch's history. The ID comes from the address
// bar, so one that is not an ID is never sent (stock-api.ts).
export function PackStockPage() {
  const { variantId = '' } = useParams();
  return <PackStock key={variantId} variantId={variantId} />;
}

function PackStock({ variantId }: { variantId: string }) {
  const list = useBatches(variantId);
  const listSearch = useListSearch();
  const title = list.data
    ? `${list.data.product.name} · ${packName(list.data.variant)}`
    : 'Pack size';
  usePageTitle(title);
  const missing = list.error instanceof ApiError && list.error.status === 404;

  return (
    <section className="max-w-4xl">
      <Link
        to={{ pathname: '/stock', search: listSearch }}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Stock
      </Link>
      {list.isPending ? (
        <>
          <h1 className="mt-3 text-2xl font-semibold">Pack size</h1>
          <ListLoading label="Loading the batches…" />
        </>
      ) : missing ? (
        <>
          <h1 className="mt-3 text-2xl font-semibold">No such pack size</h1>
          <EmptyList
            icon={SearchX}
            title="There is no such pack size"
            action={
              <Link
                to={{ pathname: '/stock', search: listSearch }}
                className={buttonClass()}
              >
                Back to the stock
              </Link>
            }
          >
            It may have been deleted, or the address is not quite right.
          </EmptyList>
        </>
      ) : list.isError ? (
        <>
          <h1 className="mt-3 text-2xl font-semibold">Pack size</h1>
          <LoadFailed
            title="The batches could not be loaded"
            message={problemMessage(list.error)}
            retrying={list.isFetching}
            onRetry={() => void list.refetch()}
          />
        </>
      ) : (
        <Batches list={list.data} title={title} />
      )}
    </section>
  );
}

function Batches({ list, title }: { list: BatchList; title: string }) {
  const { variant, product, stock, batches } = list;
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const emptyId = useId();
  // The batch a dialog is about, as the server now has it.
  const chosen = batches.find((batch) => batch.id === chosenId) ?? null;
  const open = (kind: DialogKind, batch?: Batch) => {
    setChosenId(batch?.id ?? null);
    setDialog(kind);
  };
  const close = () => setDialog(null);

  const now = useNow();
  const inUse = batches.filter((batch) => !isEmpty(batch));
  const empty = batches.filter(isEmpty);

  return (
    <>
      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {product.isActive ? null : <Tag>Draft</Tag>}
          {variant.isActive ? null : <Tag>Off sale</Tag>}
          <LevelTag level={stock.level} />
        </div>
        <p className="mt-1 font-mono text-xs text-ink-muted">{variant.sku}</p>
        <p className="mt-2 text-ink-muted">{stockCounts(stock)}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {variant.lowStockAt === 0
            ? 'Never shown as low.'
            : `Shown as low at ${packs(variant.lowStockAt)} or fewer that may be sold.`}{' '}
          <Link
            to={`/catalog/products/${product.id}`}
            className="font-medium text-primary hover:underline"
          >
            Change it on the product’s page
          </Link>
        </p>
      </header>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Batches</h2>
          <p className="text-sm text-ink-muted">
            The first to expire first: orders take them in this order.
          </p>
        </div>
        <Button
          variant="primary"
          icon={PackagePlus}
          onClick={() => open('receive')}
        >
          Receive a delivery
        </Button>
      </div>

      {inUse.length === 0 ? (
        <EmptyList
          icon={PackagePlus}
          title={batches.length === 0 ? 'No batches yet' : 'Nothing in stock'}
          action={
            <Button variant="primary" onClick={() => open('receive')}>
              Receive the first delivery
            </Button>
          }
        >
          {batches.length === 0
            ? 'Each delivery is a batch, with the number and dates on its label.'
            : 'Every batch of this pack size is empty.'}
        </EmptyList>
      ) : (
        <ul aria-label="Batches in stock" className="mt-4 space-y-3">
          {inUse.map((batch, index) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              index={index}
              state={batchState(batch, now)}
              onOpen={(kind) => open(kind, batch)}
            />
          ))}
        </ul>
      )}

      {empty.length > 0 ? (
        <div className="mt-4">
          <button
            type="button"
            aria-expanded={showEmpty}
            aria-controls={emptyId}
            onClick={() => setShowEmpty((shown) => !shown)}
            className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-ink-muted hover:text-ink"
          >
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform duration-150 ${
                showEmpty ? 'rotate-180' : ''
              }`}
            />
            {empty.length === 1
              ? '1 empty batch'
              : `${empty.length} empty batches`}
          </button>
          <div id={emptyId}>
            {showEmpty ? (
              <ul aria-label="Empty batches" className="mt-3 space-y-3">
                {empty.map((batch, index) => (
                  <BatchCard
                    key={batch.id}
                    batch={batch}
                    index={index}
                    state={batchState(batch, now)}
                    onOpen={(kind) => open(kind, batch)}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      <ReceiveDialog
        open={dialog === 'receive'}
        onClose={close}
        variantId={variant.id}
        packLabel={title}
      />
      <LabelDialog open={dialog === 'label'} onClose={close} batch={chosen} />
      <ChangeDialog open={dialog === 'change'} onClose={close} batch={chosen} />
      <CountDialog open={dialog === 'count'} onClose={close} batch={chosen} />
    </>
  );
}

const STATE_TAGS: Record<BatchState, { label: string; style: string } | null> =
  {
    selling: null,
    soon: {
      label: 'Stops selling soon',
      style: 'bg-warning-soft text-warning',
    },
    stopped: {
      label: 'No longer sold',
      style: 'bg-surface-muted text-ink-muted',
    },
    expired: { label: 'Expired', style: 'bg-danger-soft text-danger' },
  };

function stateLine(batch: Batch, state: BatchState): string {
  if (state === 'expired') {
    return `Expired on ${dayName(batch.expiresOn)}`;
  }
  return state === 'stopped'
    ? `Stopped selling on ${dayName(batch.stopsSellingOn)}`
    : `Stops selling on ${dayName(batch.stopsSellingOn)}`;
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-muted/60 px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">
        {value.toLocaleString('en-IN')}
      </dd>
    </div>
  );
}

// One batch: its label, where it stands, its packs, and what staff can do.
function BatchCard({
  batch,
  index,
  state,
  onOpen,
}: {
  batch: Batch;
  index: number;
  state: BatchState;
  onOpen: (kind: DialogKind) => void;
}) {
  const [history, setHistory] = useState(false);
  const historyId = useId();
  const headingId = useId();
  const tag = STATE_TAGS[state];
  const named = (action: string): ReactNode => (
    <>
      {action} <span className="sr-only">batch {batch.batchNumber}</span>
    </>
  );

  return (
    <motion.li
      aria-labelledby={headingId}
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { ...transition, delay: Math.min(index, 10) * 0.03 },
      }}
      className="rounded-card border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="font-medium">
          Batch <span className="font-mono">{batch.batchNumber}</span>
        </h3>
        {tag ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${tag.style}`}
          >
            {tag.label}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Made {dayName(batch.manufacturedOn)} · Expires{' '}
        {dayName(batch.expiresOn)} · {stateLine(batch, state)}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Free to sell" value={batch.quantity} />
        <Figure label="For orders to pack" value={batch.awaitingPacking} />
        <Figure label="On the shelf" value={batch.onShelf} />
        <Figure label="Packed for shipping" value={batch.packed} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon={ClipboardCheck} onClick={() => onOpen('count')}>
          {named('Count')}
        </Button>
        <Button size="sm" icon={ArrowUpDown} onClick={() => onOpen('change')}>
          {named('Change stock')}
        </Button>
        <Button size="sm" icon={PenLine} onClick={() => onOpen('label')}>
          {named('Correct label')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={History}
          aria-expanded={history}
          aria-controls={historyId}
          onClick={() => setHistory((shown) => !shown)}
        >
          {named('History')}
        </Button>
      </div>
      <div id={historyId}>
        <AnimatePresence initial={false}>
          {history ? (
            <motion.div
              key="history"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto', transition }}
              exit={{
                opacity: 0,
                height: 0,
                transition: { duration: DURATION.fast, ease: EASE_OUT },
              }}
              className="overflow-hidden"
            >
              <BatchHistory batch={batch} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

// What happened to a batch's stock, newest first.
function BatchHistory({ batch }: { batch: Batch }) {
  const moves = useMovementPages(batch.id);
  const rows = moves.data?.pages.flatMap((page) => page.movements) ?? [];

  if (moves.isPending) {
    return (
      <p className="mt-4 text-sm text-ink-muted">
        <output>Loading the history…</output>
      </p>
    );
  }
  if (moves.isError && !moves.data) {
    return (
      <div role="alert" className="mt-4 text-sm">
        <p className="text-danger">
          The history could not be loaded. {problemMessage(moves.error)}
        </p>
        <Button
          size="sm"
          className="mt-2"
          busy={moves.isFetching}
          onClick={() => void moves.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-4 border-t border-line pt-3">
      <ol
        aria-label={`History of batch ${batch.batchNumber}, newest first`}
        className="space-y-2"
      >
        {rows.map((move) => (
          <li key={move.id} className="flex items-start gap-3 text-sm">
            <span
              className={`w-16 shrink-0 text-right font-semibold tabular-nums ${
                move.change < 0 ? 'text-danger' : 'text-primary-strong'
              }`}
            >
              {signed(move.change)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{REASON_NAMES[move.reason]}</span>
              <span className="text-ink-muted">
                {' '}
                · {momentName(move.createdAt)}
              </span>
              {move.note ? (
                <span className="block break-words text-ink-muted">
                  {move.note}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {moves.hasNextPage ? (
        <div className="mt-3">
          {moves.isFetchNextPageError ? (
            <p role="alert" className="mb-2 text-sm text-danger">
              Older changes could not be loaded. {problemMessage(moves.error)}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            busy={moves.isFetchingNextPage}
            busyLabel="Loading…"
            onClick={() => void moves.fetchNextPage()}
          >
            Show older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
