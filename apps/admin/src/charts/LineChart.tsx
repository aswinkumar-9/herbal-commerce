import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { ChartTable } from './ChartTable';
import { labelledColumns, linePath, scaleFor, tickFormat } from './chart-scale';
import { useWidth } from './use-width';

export interface LinePoint {
  key: string;
  // Under the axis, short: "3 Nov".
  label: string;
  // This period's, in rupees.
  value: number;
  // The same days of the period before, in rupees.
  previous: number;
  // Said under the pointer or the arrow keys, in full, both periods:
  // "Tuesday 3 November: ₹900. Period before, 9 October: ₹300".
  readout: string;
  // Its row in the table, the first cell naming it.
  cells: string[];
}

const HEIGHT = 224;
const TOP = 12;
// The band under the plot for the labels, inside the height.
const AXIS = 28;
// Room on each side for the end dots and their rings.
const SIDE = 8;
// About how wide a character of the axis is, at 12 pixels.
const CHAR = 7;
// Room for each label under the line.
const LABEL_ROOM = 72;
// A dot's radius, and its ring in the card's colour.
const DOT = 4;
const RING = 2;

// One series over time as a line, with the period before drawn quietly
// behind it (part 15E, the owner's choice on 2026-11-27): our own SVG, only
// attributes, so the console's policy stays as it is. The line is 2 pixels
// in the series green, the period before in the strong line grey, both on
// clean gridlines from 0 or below it. A legend names both. Under the
// pointer, a hairline finds the nearest point and the line above the chart
// gives both periods' numbers; for the keyboard, a range hidden over the
// chart takes the focus and the arrow keys move along it. The whole series
// is also a table, a button away.
export function LineChart({
  label,
  points,
  tableHeaders,
  names,
}: {
  // What the chart shows, for screen readers and the table's caption.
  label: string;
  points: LinePoint[];
  tableHeaders: string[];
  // The legend: "This period", "Period before, 7 Oct – 31 Oct".
  names: { now: string; before: string };
}) {
  const frame = useRef<HTMLDivElement>(null);
  const width = useWidth(frame);
  const [active, setActive] = useState<number | null>(null);

  const scale = useMemo(
    () => scaleFor(points.flatMap((point) => [point.value, point.previous])),
    [points],
  );
  const format = useMemo(() => tickFormat(scale.ticks), [scale]);
  const left =
    8 + CHAR * Math.max(...scale.ticks.map((tick) => format(tick).length));
  const plotWidth = Math.max(1, width - left - SIDE * 2);
  const plotHeight = HEIGHT - TOP - AXIS;
  const y = (value: number) =>
    TOP + ((scale.high - value) / (scale.high - scale.low)) * plotHeight;
  const last = points.length - 1;
  const step = last > 0 ? plotWidth / last : 0;
  const x = (i: number) => left + SIDE + (last > 0 ? i * step : plotWidth / 2);
  const labelled = labelledColumns(
    points.length,
    Math.floor(plotWidth / LABEL_ROOM),
  );
  const shown = active !== null && active <= last ? active : null;

  const now = linePath(
    points.map((point, i) => ({ x: x(i), y: y(point.value) })),
  );
  const before = linePath(
    points.map((point, i) => ({ x: x(i), y: y(point.previous) })),
  );

  const point = (event: PointerEvent<SVGSVGElement>) => {
    if (last < 0) {
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const along = event.clientX - box.left - left - SIDE;
    const index = last > 0 ? Math.round(along / step) : 0;
    setActive(Math.min(last, Math.max(0, index)));
  };
  // The keys move a range along the line, from the latest when it takes
  // the focus.
  const current = shown ?? last;

  return (
    <figure className="min-w-0">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width={16} height={8} className="shrink-0">
            <line
              x1={1}
              x2={15}
              y1={4}
              y2={4}
              strokeWidth={2}
              strokeLinecap="round"
              className="stroke-series"
            />
          </svg>
          {names.now}
        </li>
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width={16} height={8} className="shrink-0">
            <line
              x1={1}
              x2={15}
              y1={4}
              y2={4}
              strokeWidth={2}
              strokeLinecap="round"
              className="stroke-line-strong"
            />
          </svg>
          {names.before}
        </li>
      </ul>
      <p
        aria-hidden="true"
        className={`mt-2 min-h-5 text-sm ${shown === null ? 'text-ink-muted' : 'font-medium text-ink'}`}
      >
        {shown === null
          ? 'Point at the chart, or use the arrow keys, to see its numbers.'
          : points[shown]?.readout}
      </p>
      <div
        ref={frame}
        className="relative mt-2 w-full rounded-lg outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-focus"
      >
        {last >= 0 ? (
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={current}
            aria-label={label}
            aria-valuetext={points[current]?.readout}
            onChange={(event) => setActive(Number(event.target.value))}
            onFocus={() => setActive((from) => from ?? last)}
            onBlur={() => setActive(null)}
            className="sr-only"
          />
        ) : null}
        <svg
          aria-hidden="true"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          onPointerMove={point}
          onPointerLeave={() => setActive(null)}
          className="block touch-pan-y"
        >
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width - SIDE}
                y1={y(tick)}
                y2={y(tick)}
                strokeWidth={1}
                shapeRendering="crispEdges"
                className={tick === 0 ? 'stroke-line-strong' : 'stroke-line'}
              />
              <text
                x={left - 8}
                y={y(tick) + 4}
                textAnchor="end"
                className="fill-ink-muted text-xs tabular-nums"
              >
                {format(tick)}
              </text>
            </g>
          ))}
          {shown !== null ? (
            <line
              data-crosshair=""
              x1={x(shown)}
              x2={x(shown)}
              y1={TOP}
              y2={TOP + plotHeight}
              strokeWidth={1}
              shapeRendering="crispEdges"
              className="stroke-line-strong"
            />
          ) : null}
          {before ? (
            <path
              data-line="before"
              d={before}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-line-strong"
            />
          ) : null}
          {now ? (
            <path
              data-line="now"
              d={now}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-series"
            />
          ) : null}
          {shown !== null ? (
            <circle
              data-dot="before"
              cx={x(shown)}
              cy={y(points[shown]?.previous ?? 0)}
              r={DOT}
              strokeWidth={RING}
              className="fill-line-strong stroke-surface"
            />
          ) : null}
          {last >= 0 ? (
            <circle
              data-dot="now"
              cx={x(shown ?? last)}
              cy={y(points[shown ?? last]?.value ?? 0)}
              r={DOT}
              strokeWidth={RING}
              className="fill-series stroke-surface"
            />
          ) : null}
          {points.map((item, i) => {
            if (!labelled.has(i)) {
              return null;
            }
            const half = (CHAR * item.label.length) / 2;
            const centre = Math.min(
              width - SIDE - half,
              Math.max(left + half, x(i)),
            );
            return (
              <text
                key={item.key}
                x={centre}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-ink-muted text-xs"
              >
                {item.label}
              </text>
            );
          })}
        </svg>
      </div>
      <ChartTable label={label} headers={tableHeaders} rows={points} />
    </figure>
  );
}
