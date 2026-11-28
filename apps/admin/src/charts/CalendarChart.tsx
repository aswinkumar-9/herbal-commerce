import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { ChartTable } from './ChartTable';
import { heatBounds, heatStep } from './chart-scale';
import { useWidth } from './use-width';

export interface CalendarDay {
  // The day in India, "2026-11-03".
  day: string;
  // Its sales, in rupees.
  value: number;
  // Said under the pointer or the arrow keys: "Tuesday 3 November: ₹900
  // from 2 orders".
  readout: string;
  // Its row in the table, the first cell naming it.
  cells: string[];
}

// Written out, so the stylesheet has each one: nothing sold, then the four
// steps from little to most.
const STEPS = [
  'fill-surface-muted',
  'fill-heat-1',
  'fill-heat-2',
  'fill-heat-3',
  'fill-heat-4',
];
const SWATCHES = [
  'bg-surface-muted',
  'bg-heat-1',
  'bg-heat-2',
  'bg-heat-3',
  'bg-heat-4',
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Room for the weekdays on the left and the months on top, the months'
// names and the weekdays' a pixel in, so their letters stay inside.
const LEFT = 32;
const TOP = 20;
// The card's colour between squares, as between columns.
const GAP = 2;
// A square never smaller than this, so it can be pointed at (the chart
// scrolls in its card on a phone instead), nor bigger than this.
const SMALLEST = 10;
const LARGEST = 18;
// Months' names at least this many weeks apart, so they never touch.
const MONTH_ROOM = 3;

const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);
// Monday 0 to Sunday 6.
const weekdayOf = (day: string) => (dateOf(day).getUTCDay() + 6) % 7;

// Each day of a period as a square in its week's column, darker the more
// it sold (part 15E, the owner's choice on 2026-11-27), to show the busy
// days of the week at a glance. Weeks run from Monday, top to bottom. One
// green in four steps, each up to a quarter more of the most sold in a day,
// and the muted surface for a day with nothing sold, or more refunded than
// sold; a day still to come is only outlined. Under the pointer, or with
// the arrow keys on a range hidden over the chart, the line above it gives
// a day's numbers; the legend says what each step holds, and the whole is
// a table, a button away.
export function CalendarChart({
  label,
  days,
  today,
  tableHeaders,
  format,
}: {
  // What the chart shows, for screen readers and the table's caption.
  label: string;
  // Every day of the period, in order.
  days: CalendarDay[];
  // Today in India: the days after it are still to come.
  today: string;
  tableHeaders: string[];
  // How the legend writes an amount: "₹250".
  format: (value: number) => string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const width = useWidth(frame);
  const [active, setActive] = useState<number | null>(null);

  const first = days[0]?.day ?? today;
  // Squares before the first day in its week.
  const offset = weekdayOf(first);
  const weeks = Math.ceil((offset + days.length) / 7);
  const cell = Math.min(
    LARGEST,
    Math.max(SMALLEST, Math.floor((width - LEFT) / Math.max(1, weeks)) - GAP),
  );
  const pitch = cell + GAP;
  const drawnWidth = LEFT + weeks * pitch;
  const height = TOP + 7 * pitch;

  const bounds = useMemo(
    () => heatBounds(Math.max(0, ...days.map((day) => day.value))),
    [days],
  );
  const last = days.length - 1;
  const shown = active !== null && active <= last ? active : null;
  const current = shown ?? last;
  const toCome = days.some((day) => day.day > today);

  const where = (i: number) => {
    const slot = offset + i;
    return {
      x: LEFT + Math.floor(slot / 7) * pitch,
      y: TOP + (slot % 7) * pitch,
    };
  };

  // Each month's name over the week its 1st falls in, and the first
  // month's over the first week, unless the next month starts too soon
  // after it.
  const starts = days.flatMap((day, i) =>
    i === 0 || day.day.endsWith('-01')
      ? [
          {
            week: Math.floor((offset + i) / 7),
            name: MONTHS[Number(day.day.slice(5, 7)) - 1] ?? '',
          },
        ]
      : [],
  );
  const months = starts.filter((start, k) => {
    const next = starts[k + 1];
    return !next || next.week - start.week >= MONTH_ROOM;
  });

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const week = Math.floor((event.clientX - box.left - LEFT) / pitch);
    const weekday = Math.floor((event.clientY - box.top - TOP) / pitch);
    const i = week * 7 + weekday - offset;
    setActive(weekday >= 0 && weekday < 7 && i >= 0 && i <= last ? i : null);
  };

  // Each step's range, from just over the last step's top to its own;
  // none for a step that holds nothing whole.
  const ranges = bounds.map((top, i) => {
    const low = i === 0 ? 1 : (bounds[i - 1] ?? 0) + 1;
    return low <= top ? { step: i + 1, low, top } : null;
  });

  return (
    <figure className="min-w-0">
      <p
        aria-hidden="true"
        className={`min-h-5 text-sm ${shown === null ? 'text-ink-muted' : 'font-medium text-ink'}`}
      >
        {shown === null
          ? 'Point at a day, or use the arrow keys, to see its numbers.'
          : days[shown]?.readout}
      </p>
      <div
        ref={frame}
        className="relative mt-2 w-full overflow-x-auto rounded-lg outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-focus"
      >
        {last >= 0 ? (
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={current}
            aria-label={label}
            aria-valuetext={days[current]?.readout}
            onChange={(event) => setActive(Number(event.target.value))}
            onFocus={() => setActive((from) => from ?? last)}
            onBlur={() => setActive(null)}
            className="sr-only"
          />
        ) : null}
        <svg
          aria-hidden="true"
          width={drawnWidth}
          height={height}
          viewBox={`0 0 ${drawnWidth} ${height}`}
          onPointerMove={point}
          onPointerLeave={() => setActive(null)}
          className="block touch-pan-x touch-pan-y"
        >
          {months.map((month) => (
            <text
              key={month.week}
              x={LEFT + month.week * pitch}
              y={TOP - 6}
              className="fill-ink-muted text-xs"
            >
              {month.name}
            </text>
          ))}
          {[0, 2, 4].map((row) => (
            <text
              key={row}
              x={1}
              y={TOP + row * pitch + cell - 1}
              className="fill-ink-muted text-xs"
            >
              {WEEKDAYS[row]}
            </text>
          ))}
          {days.map((day, i) => {
            const { x, y } = where(i);
            const toComeDay = day.day > today;
            const step = heatStep(day.value, bounds);
            const fill = toComeDay ? 'fill-surface' : STEPS[step];
            const edge =
              i === shown
                ? 'stroke-ink'
                : toComeDay
                  ? 'stroke-line-strong'
                  : 'stroke-none';
            return (
              <rect
                key={day.day}
                data-day={day.day}
                data-step={toComeDay ? 'to-come' : step}
                x={x + (toComeDay || i === shown ? 0.75 : 0)}
                y={y + (toComeDay || i === shown ? 0.75 : 0)}
                width={cell - (toComeDay || i === shown ? 1.5 : 0)}
                height={cell - (toComeDay || i === shown ? 1.5 : 0)}
                rx={2}
                strokeWidth={i === shown ? 1.5 : 1}
                className={`${fill} ${edge}`}
              />
            );
          })}
        </svg>
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-sm ${SWATCHES[0]}`}
          />
          Nothing sold
        </li>
        {ranges.map((range) =>
          range ? (
            <li key={range.step} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-2.5 rounded-sm ${SWATCHES[range.step]}`}
              />
              {range.low === range.top
                ? format(range.top)
                : `${format(range.low)}–${format(range.top)}`}
            </li>
          ) : null,
        )}
        {toCome ? (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-sm border border-line-strong"
            />
            Still to come
          </li>
        ) : null}
      </ul>
      <ChartTable
        label={label}
        headers={tableHeaders}
        rows={days.map((day) => ({ key: day.day, cells: day.cells }))}
      />
    </figure>
  );
}
