import type { ReactNode } from 'react';
import { LineChart } from '../charts/LineChart';
import type { LinePoint } from '../charts/LineChart';
import { columnLabel } from './sales-breakdown';
import { Choices } from './SalesBreakdown';
import { count, periodName } from './sales-display';
import { TILE } from './SalesFigure';
import { MAX_BARS, UNITS, addDays, barsIn, daysIn } from './sales-periods';
import type { Period, Unit } from './sales-periods';

// Things counted over time on the Sales page's tabs (part 15E): customers,
// orders. Each bar beside the same days of the period before, in the bars
// asked for.

export const UNIT_WORDS: Record<Unit, { each: string; header: string }> = {
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

interface Counted<T> {
  period: Period;
  series: { unit: Unit; points: (T & { start: string; previous: T })[] };
}

// A point for each bar of what is followed, beside the same days of the
// period before.
export function countPoints<T>(
  report: Counted<T>,
  pick: (counts: T) => number,
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
    const value = pick(point);
    const previous = pick(point.previous);
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

// A card with one count over time, the bars to draw it in, and what else
// it can follow.
export function CountChart({
  heading,
  label,
  note,
  period,
  previousPeriod,
  unit,
  onUnit,
  choices,
  points,
  column,
}: {
  heading: string;
  // The chart's name for screen readers: the heading, or more.
  label: string;
  note: string;
  period: Period;
  previousPeriod: Period;
  unit: Unit;
  onUnit: (unit: Unit) => void;
  // What else it can follow.
  choices: ReactNode;
  points: LinePoint[];
  // The table's name for what is followed.
  column: string;
}) {
  return (
    <div className={`${TILE} mt-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-md">
          <h2 className="font-semibold">{heading}</h2>
          <p className="mt-1 text-sm text-ink-muted">{note}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Choices
            label="Bars"
            value={unit}
            onChange={onUnit}
            options={UNITS.map((each) => ({
              value: each,
              label: BUTTONS[each],
              disabled: barsIn(period, each) > MAX_BARS,
            }))}
          />
          {choices}
        </div>
      </div>
      <div className="mt-4">
        <LineChart
          label={label}
          points={points}
          names={{
            now: periodName(period),
            before: periodName(previousPeriod),
          }}
          tableHeaders={[
            UNIT_WORDS[unit].header,
            column,
            'Period before',
            'Before',
          ]}
          counts
        />
      </div>
    </div>
  );
}
