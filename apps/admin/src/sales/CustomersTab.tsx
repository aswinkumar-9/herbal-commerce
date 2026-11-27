import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { problemMessage } from '../api/problems';
import { LoadFailed } from '../catalog/list-states';
import { LineChart } from '../charts/LineChart';
import type { LinePoint } from '../charts/LineChart';
import { shareName, signedRupees } from '../charts/chart-scale';
import type { CustomerCounts, CustomersReport } from './sales-api';
import { columnLabel } from './sales-breakdown';
import { Choices } from './SalesBreakdown';
import { changeFrom, count, periodName } from './sales-display';
import { Figure, FiguresLoading, TILE } from './SalesFigure';
import { MAX_BARS, UNITS, addDays, barsIn, daysIn } from './sales-periods';
import type { Unit } from './sales-periods';

type Measure = keyof CustomerCounts;

// What the chart can follow, each beside the period before.
const MEASURES: { value: Measure; label: string; title: string }[] = [
  { value: 'customers', label: 'All', title: 'Customers' },
  { value: 'newCustomers', label: 'New', title: 'New customers' },
  {
    value: 'returningCustomers',
    label: 'Returning',
    title: 'Returning customers',
  },
  { value: 'accountsMade', label: 'Accounts', title: 'Accounts made' },
];

const UNIT_WORDS: Record<Unit, { each: string; header: string }> = {
  day: { each: 'each day', header: 'Day' },
  week: { each: 'each week', header: 'Week' },
  month: { each: 'each month', header: 'Month' },
  quarter: { each: 'each quarter', header: 'Quarter' },
  year: { each: 'each financial year', header: 'Financial year' },
};
const BUTTONS: Record<Unit, string> = {
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
  quarter: 'Quarters',
  year: 'Years',
};

// A point for each bar of what the chart follows, beside the same days of
// the period before.
export function customerPoints(
  report: CustomersReport,
  measure: Measure,
): LinePoint[] {
  const { unit, points } = report.series;
  const length = daysIn(report.period);
  return points.map((point, i) => {
    const next = points[i + 1];
    const days = {
      from: point.start,
      to: next ? addDays(next.start, -1) : report.period.to,
    };
    const now = periodName(days);
    const before = periodName({
      from: addDays(days.from, -length),
      to: addDays(days.to, -length),
    });
    const value = point[measure];
    const previous = point.previous[measure];
    return {
      key: point.start,
      label: columnLabel(unit, point.start),
      value,
      previous,
      readout: `${now}: ${count(value)}. ${before}: ${count(previous)}`,
      cells: [now, count(value), before, count(previous)],
    };
  });
}

// A period's customers, for Super Users (part 15E): those who paid, new or
// returning, those who paid for more than one order, and the accounts made;
// one of them over time beside the period before; and the best customers by
// name and email, on this page only, never in a download (the owner's
// choice, 2026-11-27). Narrowed as the rest of the page is, but for the
// accounts, which have no products, state or way of paying.
export function CustomersTab({
  query,
  narrowed,
  onUnit,
}: {
  query: UseQueryResult<CustomersReport>;
  // Narrowed in any way.
  narrowed: boolean;
  onUnit: (unit: Unit) => void;
}) {
  if (query.isPending) {
    return <FiguresLoading what="the customers" />;
  }
  if (query.isError && !query.data) {
    return (
      <LoadFailed
        title="The customers could not be loaded"
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
      <Customers report={query.data} narrowed={narrowed} onUnit={onUnit} />
    </div>
  );
}

function Customers({
  report,
  narrowed,
  onUnit,
}: {
  report: CustomersReport;
  narrowed: boolean;
  onUnit: (unit: Unit) => void;
}) {
  const [measure, setMeasure] = useState<Measure>('customers');
  const { totals: now, previousTotals: before } = report;
  const changeOf = (pick: Measure) =>
    changeFrom(now[pick], before[pick], count);
  const { unit } = report.series;
  const followed =
    MEASURES.find((each) => each.value === measure) ?? MEASURES[0];
  const title = `${followed?.title ?? 'Customers'} ${UNIT_WORDS[unit].each}`;

  if (now.customers === 0 && now.accountsMade === 0) {
    return (
      <p className="mt-4 rounded-card border border-dashed border-line bg-surface p-5 text-center text-sm text-ink-muted">
        No one paid for an order or made an account in this period. Payments
        show here within 5 minutes of being made.
      </p>
    );
  }

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={TILE}>
          <Figure
            label="Customers"
            value={count(now.customers)}
            change={changeOf('customers')}
            note="Paid for at least one order in the period."
          />
        </div>
        <div className={TILE}>
          <Figure
            label="New customers"
            value={count(now.newCustomers)}
            change={changeOf('newCustomers')}
            note="Paid for the first time."
          />
        </div>
        <div className={TILE}>
          <Figure
            label="Returning customers"
            value={count(now.returningCustomers)}
            change={changeOf('returningCustomers')}
            note="Had paid before."
          />
        </div>
        <div className={TILE}>
          <Figure
            label="Bought more than once"
            value={count(now.boughtAgain)}
            change={changeOf('boughtAgain')}
            note={`${shareName(now.boughtAgain, now.customers)} of the customers paid for more than one order in the period.`}
          />
        </div>
        <div className={`${TILE} sm:col-span-2`}>
          <Figure
            label="Accounts made"
            value={count(now.accountsMade)}
            change={changeOf('accountsMade')}
            note={
              narrowed
                ? 'Customers’ accounts made in the period. Never narrowed: an account has no products, state or way of paying.'
                : 'Customers’ accounts made in the period, whether they paid or not.'
            }
          />
        </div>
      </div>

      <div className={`${TILE} mt-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              A customer counts once a bar. The grey line is the same days of
              the period before.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Choices
              label="Bars"
              value={unit}
              onChange={onUnit}
              options={UNITS.map((each) => ({
                value: each,
                label: BUTTONS[each],
                disabled: barsIn(report.period, each) > MAX_BARS,
              }))}
            />
            <Choices
              label="Show"
              value={measure}
              onChange={setMeasure}
              options={MEASURES.map(({ value, label }) => ({ value, label }))}
            />
          </div>
        </div>
        <div className="mt-4">
          <LineChart
            label={title}
            points={customerPoints(report, measure)}
            names={{
              now: periodName(report.period),
              before: periodName(report.previousPeriod),
            }}
            tableHeaders={[
              UNIT_WORDS[unit].header,
              followed?.title ?? 'Customers',
              'Period before',
              'Before',
            ]}
            counts
          />
        </div>
      </div>

      <div className={`${TILE} mt-4`}>
        <h2 className="font-semibold">Top customers</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The best 10 by what their products came to, without GST, less refunds.
          Shown here only: a download never names a customer.
        </p>
        {report.topCustomers.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            No one bought anything in this period.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Top customers</caption>
              <thead className="bg-surface-muted text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Customer
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-1.5 text-right font-medium"
                  >
                    Orders
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-1.5 text-right font-medium"
                  >
                    Sales
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.topCustomers.map((customer) => (
                  <tr key={customer.userId}>
                    <th scope="row" className="px-3 py-1.5 font-normal">
                      <span className="block font-medium">{customer.name}</span>
                      <span className="block break-words text-xs text-ink-muted">
                        {customer.email}
                      </span>
                    </th>
                    <td className="px-3 py-1.5 text-right align-top tabular-nums">
                      {count(customer.orders)}
                    </td>
                    <td className="px-3 py-1.5 text-right align-top tabular-nums">
                      {signedRupees(customer.salesRupees)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
