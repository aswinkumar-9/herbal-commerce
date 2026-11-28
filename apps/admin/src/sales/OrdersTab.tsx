import type { UseQueryResult } from '@tanstack/react-query';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { problemMessage } from '../api/problems';
import { LoadFailed } from '../catalog/list-states';
import { BarList } from '../charts/BarList';
import { DonutChart } from '../charts/DonutChart';
import type { DonutPart, PartColour } from '../charts/DonutChart';
import type { LinePoint } from '../charts/LineChart';
import { shareName, signedRupees } from '../charts/chart-scale';
import {
  REFUND_REASON_NAMES,
  REFUND_STATUS_NAMES,
} from '../orders/order-display';
import { CountChart, UNIT_WORDS, countPoints } from './CountChart';
import type { OrderCounts, OrdersReport } from './sales-api';
import { ringFits, signedCount } from './sales-breakdown';
import { Choices } from './SalesBreakdown';
import { changeFrom, count } from './sales-display';
import { Figure, FiguresLoading, TILE } from './SalesFigure';
import type { Unit } from './sales-periods';

type Measure = 'placed' | 'paid' | 'delivered' | 'cancelled' | 'expired';

// What the chart can follow of the orders placed in each bar, as they are
// now, each beside the period before.
const MEASURES: { value: Measure; label: string; column: string }[] = [
  { value: 'placed', label: 'All', column: 'Placed' },
  { value: 'paid', label: 'Paid for', column: 'Paid for' },
  { value: 'delivered', label: 'Delivered', column: 'Delivered since' },
  { value: 'cancelled', label: 'Cancelled', column: 'Cancelled since' },
  { value: 'expired', label: 'Not paid', column: 'Not paid in time' },
];

interface Step {
  key: keyof OrderCounts;
  name: string;
  colour: PartColour;
}

// Where an order can be now, each its own colour, always in this order.
const STEPS: Step[] = [
  { key: 'waitingForPayment', name: 'Waiting for payment', colour: 1 },
  { key: 'toPack', name: 'To pack', colour: 2 },
  { key: 'toShip', name: 'Packed, for the courier', colour: 3 },
  { key: 'onTheWay', name: 'On its way', colour: 4 },
  { key: 'delivered', name: 'Delivered', colour: 5 },
  { key: 'cancelled', name: 'Cancelled', colour: 6 },
  { key: 'expired', name: 'Not paid in time', colour: 7 },
];

// Who cancelled, and when.
const CANCELLERS: Step[] = [
  {
    key: 'customerCancelledUnpaid',
    name: 'The customer, before paying',
    colour: 1,
  },
  {
    key: 'customerCancelledPaid',
    name: 'The customer, after paying',
    colour: 2,
  },
  {
    key: 'staffCancelledUnpaid',
    name: 'A Super User, before paying',
    colour: 3,
  },
  {
    key: 'staffCancelledPaid',
    name: 'A Super User, after paying',
    colour: 4,
  },
];

const LINK =
  'mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-focus';

const orders = (value: number) => signedCount(value, 'order', 'orders');
const refundsWord = (value: number) => signedCount(value, 'refund', 'refunds');

// A point for each bar: the orders placed in it, or those of them that
// were paid for, delivered, cancelled or not paid in time since.
export function orderPoints(
  report: OrdersReport,
  measure: Measure,
): LinePoint[] {
  return countPoints(report, (counts) => counts[measure]);
}

// The parts of some orders, those with none left out; each keeps its
// colour.
export function partsOf(
  counts: OrderCounts,
  steps: readonly Step[],
): DonutPart[] {
  return steps
    .filter((step) => counts[step.key] > 0)
    .map((step) => ({
      key: step.key,
      name: step.name,
      value: counts[step.key],
      colour: step.colour,
      figure: orders(counts[step.key]),
    }));
}

// How long something has waited, as a person says it: "40 minutes",
// "3 hours", "2 days".
export function waitedName(since: string, at: string): string {
  // A clock a little ahead says under a minute too.
  const minutes = Math.floor((Date.parse(at) - Date.parse(since)) / 60_000);
  const said = (value: number, one: string, many: string) =>
    `${value.toLocaleString('en-IN')} ${value === 1 ? one : many}`;
  if (minutes < 1) {
    return 'under a minute';
  }
  if (minutes < 60) {
    return said(minutes, 'minute', 'minutes');
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return said(hours, 'hour', 'hours');
  }
  return said(Math.floor(hours / 24), 'day', 'days');
}

// A period's orders, for Super Users (part 15E), read live: what waits now
// at each step, whatever the period, each a way to its list; the orders
// placed in the period, each beside those of the period before, by where
// each is now and who cancelled; and the refunds asked for, by how each is
// now and by why. Narrowed as the rest of the page is.
export function OrdersTab({
  query,
  narrowed,
  byMethod,
  onUnit,
}: {
  query: UseQueryResult<OrdersReport>;
  // Narrowed in any way.
  narrowed: boolean;
  // Narrowed to a way of paying, which an unpaid order has none of.
  byMethod: boolean;
  onUnit: (unit: Unit) => void;
}) {
  if (query.isPending) {
    return <FiguresLoading what="the orders" />;
  }
  if (query.isError && !query.data) {
    return (
      <LoadFailed
        title="The orders could not be loaded"
        message={problemMessage(query.error)}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) {
    return null;
  }
  return (
    <div
      aria-busy={query.isPlaceholderData || undefined}
      className={`transition-opacity duration-150 ${
        query.isPlaceholderData ? 'opacity-60' : ''
      }`}
    >
      <Waiting report={query.data} narrowed={narrowed} />
      <Placed report={query.data} byMethod={byMethod} onUnit={onUnit} />
      <Refunds report={query.data} />
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-6">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">{note}</p>
      {children}
    </section>
  );
}

function WaitingTile({
  label,
  value,
  note,
  to,
  linkText,
  alert,
}: {
  label: string;
  value: number;
  note: string;
  to: string;
  linkText: string;
  // Money a Super User must give back by hand.
  alert?: boolean;
}) {
  return (
    <div className={TILE}>
      <h3 className="text-sm font-medium text-ink-muted">{label}</h3>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{count(value)}</p>
      {alert ? (
        <p className="mt-1 flex items-start gap-1.5 text-sm text-danger">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>{note}</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-muted">{note}</p>
      )}
      <Link to={to} className={LINK}>
        {linkText}
        <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}

function Waiting({
  report,
  narrowed,
}: {
  report: OrdersReport;
  narrowed: boolean;
}) {
  const { waiting, readAt } = report;
  const oldest = (since: string | null, words: string, none: string) =>
    since ? `The oldest ${words} ${waitedName(since, readAt)} ago.` : none;
  return (
    <Section
      title="Waiting now"
      note={`As the orders are now, whatever the period.${
        narrowed ? ' Narrowed as the page is: each list shows them all.' : ''
      }`}
    >
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <WaitingTile
          label="To pack"
          value={waiting.toPack.orders}
          note={oldest(
            waiting.toPack.since,
            'was paid for',
            'Nothing to pack.',
          )}
          to="/orders?show=to-pack"
          linkText="See the orders to pack"
        />
        <WaitingTile
          label="Packed, for the courier"
          value={waiting.toShip.orders}
          note={oldest(
            waiting.toShip.since,
            'was packed',
            'Nothing waits for the courier.',
          )}
          to="/orders?show=packed"
          linkText="See the packed orders"
        />
        <WaitingTile
          label="On its way"
          value={waiting.onTheWay.orders}
          note={oldest(
            waiting.onTheWay.since,
            'went to the courier',
            'Nothing is with a courier.',
          )}
          to="/orders?show=on-its-way"
          linkText="See the orders on their way"
        />
        <WaitingTile
          label="Waiting for payment"
          value={waiting.payment.orders}
          note={oldest(
            waiting.payment.since,
            'was placed',
            'No order waits for payment.',
          )}
          to="/orders?show=waiting"
          linkText="See the orders waiting for payment"
        />
        <WaitingTile
          label="Refunds on their way"
          value={waiting.refunds.refunds}
          note={
            waiting.refunds.since
              ? `${signedRupees(waiting.refunds.rupees)} in all. The oldest was asked for ${waitedName(waiting.refunds.since, readAt)} ago.`
              : 'None on its way.'
          }
          to="/orders/refunds"
          linkText="See the refunds"
        />
        <WaitingTile
          label="Refunds to give back by hand"
          value={waiting.failedRefunds.refunds}
          note={
            waiting.failedRefunds.since
              ? `${signedRupees(waiting.failedRefunds.rupees)} in all. Razorpay could not give these back: a Super User must, by hand.`
              : 'None failed.'
          }
          alert={waiting.failedRefunds.refunds > 0}
          to="/orders/refunds"
          linkText="See the failed refunds"
        />
      </div>
    </Section>
  );
}

function Placed({
  report,
  byMethod,
  onUnit,
}: {
  report: OrdersReport;
  byMethod: boolean;
  onUnit: (unit: Unit) => void;
}) {
  const [measure, setMeasure] = useState<Measure>('placed');
  const { totals: now, previousTotals: before } = report;
  const changeOf = (pick: keyof OrderCounts) =>
    changeFrom(now[pick], before[pick], count);
  const { unit } = report.series;
  const followed =
    MEASURES.find((each) => each.value === measure) ?? MEASURES[0];
  const heading = `Orders placed ${UNIT_WORDS[unit].each}`;
  const steps = partsOf(now, STEPS);
  const cancellers = partsOf(now, CANCELLERS);
  const note = `The orders placed in the period, as each is now, beside those placed in the period before.${
    byMethod
      ? ' Only those paid this way: an order not paid for has no way yet.'
      : ''
  }`;

  if (now.placed === 0 && before.placed === 0) {
    return (
      <Section title="Placed in the period" note={note}>
        <p className="mt-3 rounded-card border border-dashed border-line bg-surface p-5 text-center text-sm text-ink-muted">
          No order was placed in this period or the one before.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Placed in the period" note={note}>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={TILE}>
          <Figure
            heading="h3"
            label="Placed"
            value={count(now.placed)}
            change={changeOf('placed')}
            note="Paid for or not."
          />
        </div>
        <div className={TILE}>
          <Figure
            heading="h3"
            label="Paid for"
            value={count(now.paid)}
            change={changeOf('paid')}
            note={`${shareName(now.paid, now.placed)} of those placed.`}
          />
        </div>
        <div className={TILE}>
          <Figure
            heading="h3"
            label="Delivered"
            value={count(now.delivered)}
            change={changeOf('delivered')}
            note={`${shareName(now.delivered, now.placed)} of those placed, so far.`}
          />
        </div>
        <div className={TILE}>
          <Figure
            heading="h3"
            label="Cancelled"
            value={count(now.cancelled)}
            change={changeOf('cancelled')}
            better="down"
            note={`${shareName(now.cancelled, now.placed)} of those placed.`}
          />
        </div>
        <div className={`${TILE} sm:col-span-2`}>
          <Figure
            heading="h3"
            label="Not paid in time"
            value={count(now.expired)}
            change={changeOf('expired')}
            better="down"
            note="Each held its stock for 15 minutes, then gave it back."
          />
        </div>
      </div>

      <CountChart
        heading={heading}
        label={
          measure === 'placed'
            ? heading
            : `${heading}: ${followed?.column.toLowerCase() ?? ''}`
        }
        note="Each bar is the orders placed in it, as they are now. The grey line is those placed on the same days of the period before."
        period={report.period}
        previousPeriod={report.previousPeriod}
        unit={unit}
        onUnit={onUnit}
        choices={
          <Choices
            label="Show"
            value={measure}
            onChange={setMeasure}
            options={MEASURES.map(({ value, label }) => ({ value, label }))}
          />
        }
        points={orderPoints(report, measure)}
        column={followed?.column ?? 'Placed'}
      />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <Parts
          title="Where they are now"
          note="Each order placed in the period, at its step now."
          parts={steps}
          total={{ value: count(now.placed), caption: 'placed' }}
          none="No order was placed in this period."
        />
        <Parts
          title="Cancelled, by whom"
          note="After paying, the payment went back in full."
          parts={cancellers}
          total={{ value: count(now.cancelled), caption: 'cancelled' }}
          none="No order placed in this period was cancelled."
        />
      </div>
    </Section>
  );
}

// A few parts as a ring, or as bars when there are too many to read.
function Parts({
  title,
  note,
  parts,
  total,
  none,
}: {
  title: string;
  note: string;
  parts: DonutPart[];
  total: { value: string; caption: string };
  none: string;
}) {
  return (
    <div className={TILE}>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-muted">{note}</p>
      <div className="mt-4">
        {parts.length === 0 ? (
          <p className="text-sm text-ink-muted">{none}</p>
        ) : ringFits(parts) ? (
          <DonutChart label={title} parts={parts} total={total} />
        ) : (
          <BarList
            label={title}
            items={parts.map(({ key, name, value, figure }) => ({
              key,
              name,
              value,
              figure,
            }))}
          />
        )}
      </div>
    </div>
  );
}

function RefundTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string;
  rows: { key: string; name: string; refunds: number; rupees: number }[];
}) {
  const shown = rows.filter((row) => row.refunds > 0);
  const all = shown.reduce(
    (sum, row) => ({
      refunds: sum.refunds + row.refunds,
      rupees: sum.rupees + row.rupees,
    }),
    { refunds: 0, rupees: 0 },
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">
        <caption className="px-3 py-2 text-left text-sm font-medium">
          {caption}
        </caption>
        <thead className="bg-surface-muted text-xs text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-medium">
              {head}
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              Refunds
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="px-3 py-1.5 font-normal">
                {row.name}
              </th>
              <td className="px-3 py-1.5 text-right align-top tabular-nums">
                {count(row.refunds)}
              </td>
              <td className="px-3 py-1.5 text-right align-top tabular-nums">
                {signedRupees(row.rupees)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-line font-medium">
          <tr>
            <th scope="row" className="px-3 py-1.5 font-medium">
              In all
            </th>
            <td className="px-3 py-1.5 text-right tabular-nums">
              {count(all.refunds)}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums">
              {signedRupees(all.rupees)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Refunds({ report }: { report: OrdersReport }) {
  const { byStatus, byReason } = report.refunds;
  const asked = byStatus.reduce((sum, row) => sum + row.refunds, 0);
  return (
    <Section
      title="Refunds asked for"
      note="Every refund asked for in the period, by the day in India it was asked for, whatever its reason, as each is now. The Sales tabs count only those of cancelled orders: a payment an order could not take was never a sale."
    >
      <div className={`${TILE} mt-3`}>
        {asked === 0 ? (
          <p className="text-sm text-ink-muted">
            No refund was asked for in this period.
          </p>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-semibold">{refundsWord(asked)}</span>
              <span className="text-ink-muted">
                ,{' '}
                {signedRupees(
                  byStatus.reduce((sum, row) => sum + row.rupees, 0),
                )}{' '}
                in all
              </span>
            </p>
            <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">
              <RefundTable
                caption="By how each is now"
                head="Now"
                rows={byStatus.map((row) => ({
                  key: row.status,
                  name: REFUND_STATUS_NAMES[row.status],
                  refunds: row.refunds,
                  rupees: row.rupees,
                }))}
              />
              <RefundTable
                caption="By why"
                head="Why"
                rows={byReason.map((row) => ({
                  key: row.reason,
                  name: REFUND_REASON_NAMES[row.reason],
                  refunds: row.refunds,
                  rupees: row.rupees,
                }))}
              />
            </div>
          </>
        )}
        <Link to="/orders/refunds" className={LINK}>
          See every refund
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </Section>
  );
}
