import { CalendarRange, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { problemMessage } from '../api/problems';
import { LoadFailed } from '../catalog/list-states';
import { signedRupees } from '../charts/chart-scale';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { transition } from '../motion';
import { usePageTitle } from '../page-title';
import type { SalesReport, SalesTotals } from './sales-api';
import {
  averageChange,
  changeFrom,
  count,
  counted,
  periodBefore,
  periodName,
  updatedName,
} from './sales-display';
import type { Change } from './sales-display';
import {
  DEFAULT_PRESET,
  PRESETS,
  datesProblems,
  periodChoice,
} from './sales-periods';
import type { DateField, Period, PeriodChoice, Preset } from './sales-periods';
import { useSalesReport } from './sales-queries';
import { useIndiaToday } from './use-india-today';

// A period's sales, for Super Users (part 15D, ADR 0047): the totals, each
// beside the period of the same length just before. The period lives in
// the address, so a link or a reload shows the same one.
export function SalesPage() {
  usePageTitle('Sales');
  const [params, setParams] = useSearchParams();
  const today = useIndiaToday();
  const choice = periodChoice(params, today);
  const { period } = choice;
  const report = useSalesReport(period);

  function showPreset(preset: Preset) {
    setParams(preset === DEFAULT_PRESET ? {} : { period: preset.name }, {
      replace: true,
    });
  }

  function showDates({ from, to }: Period) {
    setParams({ from, to }, { replace: true });
  }

  return (
    <section className="max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="mt-1 text-ink-muted">
          What customers paid for, less what was refunded, by the day in India
          it happened. Each period is compared with the one of the same length
          just before it.
        </p>
      </header>

      <PeriodPicker
        choice={choice}
        today={today}
        onPreset={showPreset}
        onDates={showDates}
      />

      <div className="mt-4 flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
        <p>
          <span className="font-medium">{periodName(period)}</span>
          <span className="text-ink-muted">
            , compared with {periodName(periodBefore(period))}
          </span>
        </p>
        {report.data ? (
          <p className="text-ink-muted">
            {report.data.refreshedAt
              ? `Updated ${updatedName(report.data.refreshedAt, today)}. New payments show within 5 minutes.`
              : 'The figures are being worked out for the first time. Look again in a minute.'}
          </p>
        ) : null}
      </div>

      {report.isPending ? (
        <FiguresLoading />
      ) : report.isError && !report.data ? (
        <LoadFailed
          title="The sales could not be loaded"
          message={problemMessage(report.error)}
          retrying={report.isFetching}
          onRetry={() => void report.refetch()}
        />
      ) : report.data ? (
        <div
          aria-busy={report.isPlaceholderData || undefined}
          className={`transition-opacity duration-150 ${
            report.isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          <Figures report={report.data} />
        </div>
      ) : null}
    </section>
  );
}

const CHIP =
  'relative inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-[color,background-color,box-shadow] duration-150';
const CHIP_OFF =
  'border border-line bg-surface text-ink-muted shadow-clay-sm inset-shadow-clay hover:bg-surface-muted hover:text-ink';

function Chip({
  pressed,
  onClick,
  children,
  controls,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  controls?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-controls={controls}
      onClick={onClick}
      className={`${CHIP} ${pressed ? 'text-primary-strong' : CHIP_OFF}`}
    >
      {pressed ? (
        <motion.span
          layoutId="sales-period"
          transition={transition}
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-primary/50 bg-primary-soft inset-shadow-pressed"
        />
      ) : null}
      <span className="relative inline-flex items-center gap-2">
        {children}
      </span>
    </button>
  );
}

// The presets a click away, and any two days.
function PeriodPicker({
  choice,
  today,
  onPreset,
  onDates,
}: {
  choice: PeriodChoice;
  today: string;
  onPreset: (preset: Preset) => void;
  onDates: (period: Period) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const formId = useId();
  const datesOpen = choosing || choice.kind === 'dates';

  return (
    <div className="mt-6">
      <fieldset className="min-w-0">
        <legend className="text-sm font-medium">Period</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Chip
              key={preset.name}
              pressed={
                !datesOpen &&
                choice.kind === 'preset' &&
                choice.preset === preset
              }
              onClick={() => {
                setChoosing(false);
                onPreset(preset);
              }}
            >
              {preset.label}
            </Chip>
          ))}
          <Chip
            pressed={datesOpen}
            controls={datesOpen ? formId : undefined}
            onClick={() => setChoosing(true)}
          >
            <CalendarRange aria-hidden="true" className="size-4" />
            Choose days
          </Chip>
        </div>
      </fieldset>
      {datesOpen ? (
        <DatesForm
          key={`${choice.period.from}/${choice.period.to}`}
          id={formId}
          start={choice.period}
          today={today}
          onShow={(period) => {
            setChoosing(false);
            onDates(period);
          }}
        />
      ) : null}
    </div>
  );
}

// Two days, the first and the last of the period, both included. Checked
// here first, as the API checks them.
function DatesForm({
  id,
  start,
  today,
  onShow,
}: {
  id: string;
  start: Period;
  today: string;
  onShow: (period: Period) => void;
}) {
  const [values, setValues] = useState(start);
  const [problems, setProblems] = useState<Partial<Record<DateField, string>>>(
    {},
  );
  const boxes = useRef<Partial<Record<DateField, HTMLInputElement | null>>>({});

  function set(field: DateField, value: string) {
    setValues((now) => ({ ...now, [field]: value }));
    if (problems[field]) {
      setProblems((now) => {
        const next = { ...now };
        delete next[field];
        return next;
      });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = datesProblems(values.from, values.to);
    setProblems(found);
    const first = (['from', 'to'] as const).find((field) => found[field]);
    if (first) {
      boxes.current[first]?.focus();
      return;
    }
    onShow(values);
  }

  return (
    <form
      id={id}
      noValidate
      aria-label="Choose the days"
      onSubmit={submit}
      className="mt-4 flex flex-wrap items-start gap-4 rounded-card border border-line bg-surface p-4 shadow-clay-sm inset-shadow-clay"
    >
      <Field
        ref={(box) => {
          boxes.current.from = box;
        }}
        className="w-full sm:w-44"
        label="First day"
        type="date"
        value={values.from}
        max={today}
        onChange={(event) => set('from', event.target.value)}
        error={problems.from}
      />
      <Field
        ref={(box) => {
          boxes.current.to = box;
        }}
        className="w-full sm:w-44"
        label="Last day"
        type="date"
        value={values.to}
        max={today}
        onChange={(event) => set('to', event.target.value)}
        error={problems.to}
      />
      <Button type="submit" variant="primary" className="sm:mt-7">
        Show these days
      </Button>
    </form>
  );
}

const TILE =
  'rounded-card border border-line bg-surface p-5 shadow-clay inset-shadow-clay';

function ChangeLine({ change }: { change: Change }) {
  const Icon =
    change.direction === 'up'
      ? TrendingUp
      : change.direction === 'down'
        ? TrendingDown
        : change.direction === 'same'
          ? Minus
          : null;
  return (
    <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-muted">
      {Icon ? (
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      ) : null}
      <span>{change.words}</span>
    </p>
  );
}

// One figure under its name, a heading to find it by, and how it moved
// since the period before.
function Figure({
  label,
  value,
  change,
  note,
  size = 'md',
}: {
  label: string;
  value: string;
  change: Change;
  note?: string;
  size?: 'lg' | 'md';
}) {
  return (
    <div>
      <h2 className="text-sm font-medium text-ink-muted">{label}</h2>
      <p
        className={`mt-1 font-semibold tabular-nums ${size === 'lg' ? 'text-4xl' : 'text-2xl'}`}
      >
        {value}
      </p>
      <ChangeLine change={change} />
      {note ? <p className="mt-2 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

function Figures({ report }: { report: SalesReport }) {
  const { totals: now, previousTotals: before } = report;
  const rupeesChange = (pick: (totals: SalesTotals) => number) =>
    changeFrom(pick(now), pick(before), signedRupees);
  const countChange = (pick: (totals: SalesTotals) => number) =>
    changeFrom(pick(now), pick(before), count);
  const quiet = now.orders === 0 && now.refundedOrders === 0;

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={`${TILE} sm:col-span-2`}>
          <Figure
            size="lg"
            label="Sales"
            value={signedRupees(now.salesRupees)}
            change={rupeesChange((totals) => totals.salesRupees)}
            note="What the products sold for, without GST, less refunds."
          />
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
            <Part label="GST" value={signedRupees(now.gstRupees)} />
            <Part label="Delivery" value={signedRupees(now.deliveryRupees)} />
            <Part
              label="Paid in all"
              value={signedRupees(now.paidRupees)}
              note="With GST and delivery"
            />
          </dl>
        </div>
        <div className={`${TILE} space-y-5`}>
          <Figure
            label="New customers"
            value={count(now.newCustomers)}
            change={countChange((totals) => totals.newCustomers)}
            note="Paid for the first time."
          />
          <Figure
            label="Returning customers"
            value={count(now.returningCustomers)}
            change={countChange((totals) => totals.returningCustomers)}
            note="Had paid before."
          />
        </div>
        <div className={TILE}>
          <Figure
            label="Orders"
            value={count(now.orders)}
            change={countChange((totals) => totals.orders)}
            note="Paid in the period."
          />
        </div>
        <div className={TILE}>
          <Figure
            label="Average order"
            value={
              now.averageOrderRupees === null
                ? 'No orders'
                : signedRupees(now.averageOrderRupees)
            }
            change={averageChange(
              now.averageOrderRupees,
              before.averageOrderRupees,
            )}
            note="Its products without GST, before any refund."
          />
        </div>
        <div className={TILE}>
          <Figure
            label="Refunds"
            value={signedRupees(now.refundedRupees)}
            change={rupeesChange((totals) => totals.refundedRupees)}
            note={`${counted(now.refundedOrders, 'order', 'orders')} refunded in the period, everything included.`}
          />
        </div>
      </div>
      {quiet ? (
        <p className="mt-4 rounded-card border border-dashed border-line bg-surface p-5 text-center text-sm text-ink-muted">
          Nothing was paid for or refunded in this period. Payments show here
          within 5 minutes of being made.
        </p>
      ) : null}
    </>
  );
}

function Part({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
      {note ? <dd className="text-xs text-ink-muted">{note}</dd> : null}
    </div>
  );
}

// Shaped like the figures, while they load.
function FiguresLoading() {
  return (
    <div className="mt-4">
      <output className="sr-only">Loading the sales…</output>
      <div
        aria-hidden="true"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="h-56 animate-pulse rounded-card bg-surface-muted sm:col-span-2" />
        <div className="h-56 animate-pulse rounded-card bg-surface-muted" />
        {[0, 1, 2].map((tile) => (
          <div
            key={tile}
            className="h-36 animate-pulse rounded-card bg-surface-muted"
          />
        ))}
      </div>
    </div>
  );
}
