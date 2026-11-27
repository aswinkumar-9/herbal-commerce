import { CalendarRange, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PageTabs } from '../layout/PageTabs';
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
  toneOf,
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
  unitChoice,
} from './sales-periods';
import type {
  DateField,
  Period,
  PeriodChoice,
  Preset,
  Unit,
} from './sales-periods';
import { DownloadReport } from './DownloadReport';
import { SalesOverTime, SalesPlaces } from './SalesBreakdown';
import { SalesFilterBar } from './SalesFilterBar';
import { METHOD_NAMES, NOT_RECORDED } from './sales-breakdown';
import {
  NOT_RECORDED_METHOD,
  filterFrom,
  filterParams,
  keepsProducts,
} from './sales-filters';
import type { FilterKind, FilterMatch, SalesFilter } from './sales-filters';
import { useSalesReport } from './sales-queries';
import { useIndiaToday } from './use-india-today';

// The period as the address keeps it: nothing for the default.
function periodParams(choice: PeriodChoice): Record<string, string> {
  if (choice.kind === 'dates') {
    return { from: choice.period.from, to: choice.period.to };
  }
  return choice.preset === DEFAULT_PRESET ? {} : { period: choice.preset.name };
}

// What each filter in use is called: as the search found it, else as the
// report names it once it has come.
function filterNames(
  filter: SalesFilter,
  found: Record<string, string>,
  report: SalesReport | undefined,
): Partial<Record<FilterKind, string>> {
  const named = report?.filters;
  const category =
    named?.category && named.category.categoryId === filter.category
      ? named.category
      : null;
  const reported: Partial<Record<FilterKind, string | null>> = {
    product:
      named?.product?.productId === filter.product
        ? named?.product?.name
        : null,
    category: category?.name
      ? category.parentName
        ? `${category.parentName} › ${category.name}`
        : category.name
      : null,
    brand: named?.brand?.brandId === filter.brand ? named?.brand?.name : null,
  };
  const names: Partial<Record<FilterKind, string>> = {};
  for (const kind of ['product', 'category', 'brand'] as const) {
    const id = filter[kind];
    const name = id ? (found[`${kind}:${id}`] ?? reported[kind]) : null;
    if (id) {
      names[kind] = name ?? (report ? 'Not found' : '…');
    }
  }
  // A state is its own name, and a way of paying is named as on the page.
  if (filter.state) {
    names.state = filter.state;
  }
  if (filter.method) {
    names.method =
      filter.method === NOT_RECORDED_METHOD
        ? NOT_RECORDED
        : (METHOD_NAMES[filter.method as keyof typeof METHOD_NAMES] ??
          filter.method);
  }
  return names;
}

export type SalesTab = 'overview' | 'places';

// A period's sales, for Super Users (part 15D, ADR 0047): the totals, each
// beside the period of the same length just before, narrowed or not to a
// product, a category or a brand, and since part 15E to a state or a way
// of paying. Two tabs (part 15E): the overview, over time, and where the
// sales went and what they were made of, each name a way to narrow the
// page. The period, the filters and the chart's bars live in the address,
// so a link, a reload or the other tab shows the same.
export function SalesPage({ tab = 'overview' }: { tab?: SalesTab }) {
  usePageTitle(tab === 'places' ? 'Sales by place and catalog' : 'Sales');
  const [params, setParams] = useSearchParams();
  const today = useIndiaToday();
  const choice = periodChoice(params, today);
  const { period } = choice;
  const filter = filterFrom(params);
  const unit = unitChoice(params, period);
  const report = useSalesReport(period, filter, unit);
  // The names of what the search found, or of what was chosen, by kind and
  // ID.
  const [found, setFound] = useState<Record<string, string>>({});
  const query = params.toString();
  const tabs = [
    { to: `/sales${query ? `?${query}` : ''}`, label: 'Overview', end: true },
    {
      to: `/sales/places${query ? `?${query}` : ''}`,
      label: 'Places and catalog',
    },
  ];

  function show(
    periodPart: Record<string, string>,
    filterPart: SalesFilter = filter,
    unitPart: Unit | undefined = unit,
  ) {
    setParams(
      {
        ...periodPart,
        ...filterParams(filterPart),
        ...(unitPart ? { unit: unitPart } : {}),
      },
      { replace: true },
    );
  }

  function showPreset(preset: Preset) {
    show(preset === DEFAULT_PRESET ? {} : { period: preset.name });
  }

  function showDates({ from, to }: Period) {
    show({ from, to });
  }

  function choose(match: FilterMatch) {
    setFound((now) => ({ ...now, [`${match.kind}:${match.id}`]: match.name }));
    show(periodParams(choice), { ...filter, [match.kind]: match.id });
  }

  function remove(kind: FilterKind) {
    show(periodParams(choice), { ...filter, [kind]: undefined });
  }

  // A name chosen in a list: narrowed to it, or back to everything when it
  // was already chosen.
  function pick(kind: FilterKind, id: string, name: string) {
    if (filter[kind] === id) {
      remove(kind);
      return;
    }
    choose({ kind, id, name });
  }

  return (
    <section className="max-w-5xl">
      <PageTabs label="Sales" tabs={tabs} layoutId="sales-tab" />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold">Sales</h1>
          <p className="mt-1 text-ink-muted">
            What customers paid for, less what was refunded, by the day in India
            it happened. Each period is compared with the one of the same length
            just before it.
          </p>
        </div>
        <DownloadReport period={period} filter={filter} />
      </header>

      <PeriodPicker
        choice={choice}
        today={today}
        onPreset={showPreset}
        onDates={showDates}
      />

      <SalesFilterBar
        filter={filter}
        names={filterNames(filter, found, report.data)}
        onChoose={choose}
        onRemove={remove}
        onClear={() => show(periodParams(choice), {})}
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
          <Figures
            report={report.data}
            filtered={keepsProducts(filter)}
            tab={tab}
            today={today}
            filter={filter}
            onUnit={(chosen) => show(periodParams(choice), filter, chosen)}
            onPick={pick}
          />
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

// Green when it got better, red when worse, the quiet ink otherwise; its
// arrow and words say which way, and screen readers hear whether that is
// for the better.
const TONES = {
  better: { colour: 'text-good', words: ', for the better' },
  worse: { colour: 'text-danger', words: ', for the worse' },
  neutral: { colour: 'text-ink-muted', words: '' },
} as const;

function ChangeLine({
  change,
  better,
}: {
  change: Change;
  better: 'up' | 'down';
}) {
  const tone = TONES[toneOf(change, better)];
  const Icon =
    change.direction === 'up'
      ? TrendingUp
      : change.direction === 'down'
        ? TrendingDown
        : change.direction === 'same'
          ? Minus
          : null;
  return (
    <p className={`mt-1 flex items-start gap-1.5 text-sm ${tone.colour}`}>
      {Icon ? (
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      ) : null}
      <span>
        {change.words}
        {tone.words ? <span className="sr-only">{tone.words}</span> : null}
      </span>
    </p>
  );
}

// One figure under its name, a heading to find it by, and how it moved
// since the period before.
function Figure({
  label,
  value,
  change,
  better = 'up',
  note,
  size = 'md',
}: {
  label: string;
  value: string;
  change: Change;
  // Which way is for the better: up, but for refunds.
  better?: 'up' | 'down';
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
      <ChangeLine change={change} better={better} />
      {note ? <p className="mt-2 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

function Figures({
  report,
  filtered,
  tab,
  today,
  filter,
  onUnit,
  onPick,
}: {
  report: SalesReport;
  // Narrowed to some products: every figure is theirs alone.
  filtered: boolean;
  tab: SalesTab;
  today: string;
  filter: SalesFilter;
  onUnit: (unit: Unit) => void;
  onPick: (kind: FilterKind, id: string, name: string) => void;
}) {
  const { totals: now, previousTotals: before } = report;
  const rupeesChange = (pick: (totals: SalesTotals) => number) =>
    changeFrom(pick(now), pick(before), signedRupees);
  const countChange = (pick: (totals: SalesTotals) => number) =>
    changeFrom(pick(now), pick(before), count);
  const quiet = now.orders === 0 && now.refundedOrders === 0;

  const quietNote = quiet ? (
    <p className="mt-4 rounded-card border border-dashed border-line bg-surface p-5 text-center text-sm text-ink-muted">
      {filtered
        ? 'None of these were paid for or refunded in this period.'
        : 'Nothing was paid for or refunded in this period.'}{' '}
      Payments show here within 5 minutes of being made.
    </p>
  ) : null;
  if (tab === 'places') {
    return (
      quietNote ?? (
        <SalesPlaces report={report} filter={filter} onPick={onPick} />
      )
    );
  }

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={`${TILE} sm:col-span-2`}>
          <Figure
            size="lg"
            label="Sales"
            value={signedRupees(now.salesRupees)}
            change={rupeesChange((totals) => totals.salesRupees)}
            note={
              filtered
                ? 'What these products sold for, without GST, less refunds.'
                : 'What the products sold for, without GST, less refunds.'
            }
          />
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
            <Part label="GST" value={signedRupees(now.gstRupees)} />
            {now.deliveryRupees === null ? (
              <Part
                label="Delivery"
                value="Not split"
                note="Charged on whole orders"
              />
            ) : (
              <Part label="Delivery" value={signedRupees(now.deliveryRupees)} />
            )}
            <Part
              label={filtered ? 'Paid for these' : 'Paid in all'}
              value={signedRupees(now.paidRupees)}
              note={filtered ? 'With GST' : 'With GST and delivery'}
            />
          </dl>
        </div>
        <div className={`${TILE} space-y-5`}>
          <Figure
            label="New customers"
            value={count(now.newCustomers)}
            change={countChange((totals) => totals.newCustomers)}
            note={
              filtered
                ? 'Paid for the first time, with these in.'
                : 'Paid for the first time.'
            }
          />
          <Figure
            label="Returning customers"
            value={count(now.returningCustomers)}
            change={countChange((totals) => totals.returningCustomers)}
            note={
              filtered ? 'Had paid before, for anything.' : 'Had paid before.'
            }
          />
        </div>
        <div className={TILE}>
          <Figure
            label="Orders"
            value={count(now.orders)}
            change={countChange((totals) => totals.orders)}
            note={
              filtered
                ? 'Paid in the period, with these in.'
                : 'Paid in the period.'
            }
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
            note={
              filtered
                ? 'These products in an order, without GST, before any refund.'
                : 'Its products without GST, before any refund.'
            }
          />
        </div>
        <div className={TILE}>
          <Figure
            label="Refunds"
            value={signedRupees(now.refundedRupees)}
            change={rupeesChange((totals) => totals.refundedRupees)}
            better="down"
            note={
              filtered
                ? `${counted(now.refundedOrders, 'order', 'orders')} with these in refunded in the period: what these came to, GST included.`
                : `${counted(now.refundedOrders, 'order', 'orders')} refunded in the period, everything included.`
            }
          />
        </div>
      </div>
      {quietNote ?? (
        <SalesOverTime report={report} today={today} onUnit={onUnit} />
      )}
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
