import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Circle,
  CircleCheck,
  CircleMinus,
  CircleX,
  LoaderCircle,
  PackageCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useBottomBar } from '../components/bottom-bar';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { useToasts } from '../components/toast-context';
import { DURATION, EASE_OUT, transition } from '../motion';
import { placeName } from './order-display';
import { Problem, STEPPING } from './OrderDialogs';
import type { Order, OrderSummary } from './orders-api';
import { ordersChanged } from './orders-queries';
import { packEach } from './pack-several';
import type { PackResult } from './pack-several';

// Packing several at once (ADR 0037): tick the orders whose boxes are
// packed on the To pack list, then mark them packed together. The console
// sends them one at a time and says what became of each.

// The bar that rises in while orders are chosen, and stays in view at the
// bottom of the page however long the list.
export function PackBar({
  count,
  onClear,
  onPack,
}: {
  count: number;
  onClear: () => void;
  onPack: () => void;
}) {
  const bar = useBottomBar<HTMLDivElement>();
  return (
    <motion.div
      ref={bar}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition }}
      exit={{
        opacity: 0,
        y: 12,
        transition: { duration: DURATION.fast, ease: EASE_OUT },
      }}
      className="glass sticky bottom-4 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line/70 px-4 py-3 shadow-clay inset-shadow-glass print:hidden"
    >
      <output className="text-sm font-medium">{count} chosen</output>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onClear}>
          Clear the choice
        </Button>
        <Button variant="primary" icon={PackageCheck} onClick={onPack}>
          Mark {count} packed
        </Button>
      </div>
    </motion.div>
  );
}

const ordersName = (count: number) =>
  count === 1 ? 'One order' : `${count} orders`;

// Asks first, as each customer is emailed and a packed order can't go back
// to being paid. Then packs them in turn, ticking each off, and stays open
// to say why any was not packed. Those it could not send stay chosen.
export function PackSeveralDialog({
  open,
  orders,
  onClose,
  onFinished,
}: {
  open: boolean;
  orders: readonly OrderSummary[];
  onClose: () => void;
  // The orders to keep chosen once the run is over: those still to pack.
  onFinished: (keep: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [results, setResults] = useState<ReadonlyMap<string, PackResult>>(
    new Map(),
  );
  const run = useMutation({
    mutationKey: STEPPING,
    mutationFn: () =>
      packEach(orders, (id, result) =>
        setResults((now) => new Map(now).set(id, result)),
      ),
    onSuccess: (all) => {
      const packed: Order[] = [];
      let refused = 0;
      const keep: string[] = [];
      for (const order of orders) {
        const result = all.get(order.id);
        if (result?.state === 'packed') {
          packed.push(result.order);
        } else if (result?.state === 'refused') {
          refused += 1;
        } else {
          keep.push(order.id);
        }
      }
      // Those refused moved on: the lists are out of date too.
      if (packed.length > 0 || refused > 0) {
        ordersChanged(queryClient, packed);
      }
      const [first] = packed;
      if (first) {
        toasts.show(
          packed.length === 1
            ? `${first.reference} packed`
            : `${packed.length} orders packed`,
        );
      }
      onFinished(keep);
      if (packed.length === orders.length) {
        onClose();
      }
    },
  });

  const total = orders.length;
  const done = results.size;
  const finished = run.isSuccess;
  const packedCount = [...results.values()].filter(
    (result) => result.state === 'packed',
  ).length;
  const notPacked = total - packedCount;
  const stillToPack = [...results.values()].some(
    (result) => result.state === 'failed' || result.state === 'unsent',
  );
  const [only] = orders;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={run.isPending}
      size="md"
      title={
        finished
          ? `${packedCount} of ${total} packed`
          : total === 1 && only
            ? `Mark ${only.reference} packed?`
            : `Mark ${total} orders packed?`
      }
      description={
        finished ? null : total === 1 ? (
          <p>
            Only once its box is packed and closed. The customer gets an email
            saying so, and it can’t be undone.
          </p>
        ) : (
          <p>
            Only once every box is packed and closed. Each customer gets an
            email saying so, and it can’t be undone. They are marked one at a
            time.
          </p>
        )
      }
      actions={
        <>
          {finished ? null : (
            <Button onClick={onClose} disabled={run.isPending}>
              Not yet
            </Button>
          )}
          <Button
            variant="primary"
            icon={finished ? undefined : PackageCheck}
            onClick={finished ? onClose : () => run.mutate()}
            busy={run.isPending}
            busyLabel={`Marking ${Math.min(done + 1, total)} of ${total}…`}
          >
            {finished
              ? 'Close'
              : total === 1
                ? 'Mark packed'
                : `Mark ${total} packed`}
          </Button>
        </>
      }
    >
      {finished && notPacked > 0 ? (
        <div className="mt-4">
          <Problem>
            {ordersName(notPacked)} {notPacked === 1 ? 'was' : 'were'} not
            packed. The reason is under {notPacked === 1 ? 'it' : 'each'}.
            {stillToPack
              ? ' Those still to pack stay chosen, to try again.'
              : null}
          </Problem>
        </div>
      ) : null}

      {total > 1 && !finished ? (
        <div aria-hidden="true" className="mt-4 h-1.5 rounded-full bg-line">
          <motion.div
            initial={false}
            animate={{ scaleX: done / total }}
            transition={transition}
            className="h-full origin-left rounded-full bg-primary"
          />
        </div>
      ) : null}
      <output className="sr-only">
        {run.isPending ? `${done} of ${total} done` : ''}
      </output>

      <ul
        aria-label="Chosen orders"
        className="mt-4 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line"
      >
        {orders.map((order, index) => (
          <ChosenOrder
            key={order.id}
            order={order}
            result={results.get(order.id)}
            current={run.isPending && index === done}
          />
        ))}
      </ul>
    </Dialog>
  );
}

function ChosenOrder({
  order,
  result,
  current,
}: {
  order: OrderSummary;
  result: PackResult | undefined;
  current: boolean;
}) {
  const icon = 'mt-0.5 size-4 shrink-0';
  return (
    <li className="flex items-start gap-3 px-3 py-2 text-sm">
      {current ? (
        <LoaderCircle
          aria-hidden="true"
          className={`${icon} animate-spin text-ink-muted`}
        />
      ) : result?.state === 'packed' ? (
        <CircleCheck
          aria-hidden="true"
          className={`${icon} text-primary-strong`}
        />
      ) : result?.state === 'refused' || result?.state === 'failed' ? (
        <CircleX aria-hidden="true" className={`${icon} text-danger`} />
      ) : result?.state === 'unsent' ? (
        <CircleMinus aria-hidden="true" className={`${icon} text-ink-muted`} />
      ) : (
        <Circle aria-hidden="true" className={`${icon} text-line-strong`} />
      )}
      <div className="min-w-0 flex-1">
        <p>
          <span className="font-mono font-medium">{order.reference}</span>
          <span className="text-ink-muted">
            {' '}
            · {order.deliveryName}, {placeName(order)}
          </span>
        </p>
        {result?.state === 'packed' ? (
          <p className="text-primary-strong">Packed</p>
        ) : result?.state === 'refused' || result?.state === 'failed' ? (
          <p className="text-danger">{result.message}</p>
        ) : result?.state === 'unsent' ? (
          <p className="text-ink-muted">Not sent</p>
        ) : null}
      </div>
    </li>
  );
}
