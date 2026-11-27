import { ChevronDown, ChevronUp } from 'lucide-react';
import { useId, useState } from 'react';
import { BarList } from '../charts/BarList';
import type { BarListItem } from '../charts/BarList';
import { CalendarChart } from '../charts/CalendarChart';
import { ColumnChart } from '../charts/ColumnChart';
import { DonutChart } from '../charts/DonutChart';
import { LineChart } from '../charts/LineChart';
import { signedRupees } from '../charts/chart-scale';
import { Button } from '../components/Button';
import type { SalesReport } from './sales-api';
import {
  UNIT_NAMES,
  brandItems,
  calendarDays,
  categoryItems,
  linePoints,
  methodItems,
  methodParts,
  productItems,
  ringFits,
  seriesColumns,
  stateItems,
} from './sales-breakdown';
import { periodName } from './sales-display';
import { NOT_RECORDED_METHOD } from './sales-filters';
import type { FilterKind, SalesFilter } from './sales-filters';
import { MAX_BARS, UNITS, barsIn, daysIn } from './sales-periods';
import type { Unit } from './sales-periods';

const CARD =
  'rounded-card border border-line bg-surface p-5 shadow-clay inset-shadow-clay';

// A list this long or shorter shows whole; a longer one shows its best
// until asked for the rest.
const SHOWN_AT_FIRST = 10;

// A calendar only for two weeks or more: a shorter period is a column or
// two of squares.
const CALENDAR_FROM_DAYS = 14;

const UNIT_NOTES: Record<Unit, string> = {
  day: '',
  week: ' Weeks start on Monday.',
  month: '',
  quarter: ' Quarters start in January, April, July and October.',
  year: ' Financial years run from April to March.',
};

type Shape = 'line' | 'columns';

// The period's sales over time (part 15D, ADR 0047), since part 15E as a
// line beside the same days of the period before, or as columns, in the
// bars chosen, and each day as a calendar.
export function SalesOverTime({
  report,
  today,
  onUnit,
}: {
  report: SalesReport;
  today: string;
  onUnit: (unit: Unit) => void;
}) {
  const [shape, setShape] = useState<Shape>('line');
  const { unit } = report.series;
  const names = UNIT_NAMES[unit];
  const days = calendarDays(report);
  return (
    <>
      <div className={`${CARD} mt-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <h2 className="font-semibold">{names.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Without GST, less refunds.{UNIT_NOTES[unit]}
              {shape === 'line'
                ? ' The grey line is the same days of the period before.'
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Choices
              label="Bars"
              value={unit}
              onChange={onUnit}
              options={UNITS.map((each) => ({
                value: each,
                label: UNIT_NAMES[each].button,
                disabled: barsIn(report.period, each) > MAX_BARS,
              }))}
            />
            <Choices
              label="Shape"
              value={shape}
              onChange={setShape}
              options={[
                { value: 'line', label: 'Line' },
                { value: 'columns', label: 'Columns' },
              ]}
            />
          </div>
        </div>
        <div className="mt-4">
          {shape === 'line' ? (
            <LineChart
              label={names.title}
              points={linePoints(report)}
              names={{
                now: periodName(report.period),
                before: periodName(report.previousPeriod),
              }}
              tableHeaders={[
                names.header,
                'Sales',
                'Orders',
                'Period before',
                'Sales before',
                'Orders before',
              ]}
            />
          ) : (
            <ColumnChart
              label={names.title}
              columns={seriesColumns(report)}
              tableHeaders={[names.header, 'Sales', 'Orders']}
            />
          )}
        </div>
      </div>
      {days && daysIn(report.period) >= CALENDAR_FROM_DAYS ? (
        <div className={`${CARD} mt-4`}>
          <h2 className="font-semibold">Each day</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Darker for more sales, without GST, less refunds. Each column is a
            week, from Monday.
          </p>
          <div className="mt-4">
            <CalendarChart
              label="Sales each day, as a calendar"
              days={days}
              today={today}
              tableHeaders={['Day', 'Weekday', 'Sales', 'Orders']}
              format={signedRupees}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

// Where the sales went and what they were made of (part 15D, ADR 0047),
// since part 15E on a tab of their own: the states the orders went to, how
// customers paid, the categories with their subcategories, the best brands
// and the best products. Choosing a name narrows the whole page to it, and
// choosing it again shows everything again.
export function SalesPlaces({
  report,
  filter,
  onPick,
}: {
  report: SalesReport;
  filter: SalesFilter;
  onPick: (kind: FilterKind, id: string, name: string) => void;
}) {
  const parts = methodParts(report);
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const methodOf = (key: string) =>
    key === 'not-recorded' ? NOT_RECORDED_METHOD : key;
  // A subcategory is named with its top category, as in the catalog.
  const categoryName = (id: string, name: string) => {
    const top = report.categories.find((category) =>
      category.subcategories.some((sub) => sub.categoryId === id),
    );
    return top?.name ? `${top.name} › ${name}` : name;
  };
  const named = (item: BarListItem) =>
    typeof item.name === 'string' ? item.name : item.key;

  return (
    <>
      <p className="mt-4 text-sm text-ink-muted">
        Choose a name to see only its sales, on both tabs; choose it again to
        see them all.
      </p>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <TopList
          title="States"
          note="Where the orders were delivered."
          items={stateItems(report)}
          onPick={(item) => onPick('state', item.key, named(item))}
          picked={(item) => filter.state === item.key}
        />
        <div className={CARD}>
          <h2 className="font-semibold">Payment methods</h2>
          <p className="mt-1 text-sm text-ink-muted">
            As customers paid on Razorpay, each a share of the sales.
          </p>
          <div className="mt-4">
            {parts.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing in this period.</p>
            ) : ringFits(parts) ? (
              <DonutChart
                label="Payment methods"
                parts={parts}
                total={{ value: signedRupees(total), caption: 'in sales' }}
                onPick={(part) =>
                  onPick('method', methodOf(part.key), part.name)
                }
                picked={(part) => filter.method === methodOf(part.key)}
              />
            ) : (
              <BarList
                label="Payment methods"
                items={methodItems(report)}
                onPick={(item) =>
                  onPick('method', methodOf(item.key), named(item))
                }
                picked={(item) => filter.method === methodOf(item.key)}
              />
            )}
          </div>
        </div>
        <TopList
          title="Categories"
          note="Each with its subcategories under it, whose sales it includes."
          items={categoryItems(report)}
          onPick={(item) =>
            onPick('category', item.key, categoryName(item.key, named(item)))
          }
          picked={(item) => filter.category === item.key}
        />
        <TopList
          title="Top brands"
          note="The best 10."
          items={brandItems(report)}
          onPick={(item) => onPick('brand', item.key, named(item))}
          picked={(item) => filter.brand === item.key}
        />
        <TopList
          title="Top products"
          note="The best 10, without GST, less refunds."
          items={productItems(report)}
          onPick={(item) => onPick('product', item.key, named(item))}
          picked={(item) => filter.product === item.key}
        />
      </div>
    </>
  );
}

// A small row of buttons, one of them pressed, on two lines in a narrow
// card.
export function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface-muted p-1 inset-shadow-well"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          title={
            option.disabled
              ? 'Too many for one chart: choose bigger bars'
              : undefined
          }
          onClick={() => onChange(option.value)}
          className="h-8 rounded-full px-3 text-xs font-medium text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-ink-muted aria-pressed:bg-surface aria-pressed:text-primary-strong aria-pressed:shadow-clay-sm"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TopList({
  title,
  note,
  items,
  onPick,
  picked,
}: {
  title: string;
  note: string;
  items: BarListItem[];
  onPick?: (item: BarListItem) => void;
  picked?: (item: BarListItem) => boolean;
}) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const long = items.length > SHOWN_AT_FIRST;
  const shown = all || !long ? items : items.slice(0, SHOWN_AT_FIRST);
  return (
    <div className={CARD}>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{note}</p>
      <div id={listId} className="mt-4">
        {items.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing in this period.</p>
        ) : (
          <BarList
            label={title}
            items={shown}
            onPick={onPick}
            picked={picked}
          />
        )}
      </div>
      {long ? (
        <Button
          variant="ghost"
          size="sm"
          icon={all ? ChevronUp : ChevronDown}
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((open) => !open)}
          className="mt-3"
        >
          {all ? `Show the best ${SHOWN_AT_FIRST}` : `Show all ${items.length}`}
        </Button>
      ) : null}
    </div>
  );
}
