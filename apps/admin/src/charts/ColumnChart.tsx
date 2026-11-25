import { Table2 } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';
import { Button } from '../components/Button';
import {
  columnPath,
  labelledColumns,
  scaleFor,
  tickFormat,
} from './chart-scale';

export interface ChartColumn {
  key: string;
  // Under its column, short: "3 Nov".
  label: string;
  // Its height, in rupees.
  value: number;
  // Said under the pointer or the arrow keys, in full: "Tuesday 3 November:
  // ₹900 from 2 orders".
  readout: string;
  // Its row in the table, the first cell naming it.
  cells: string[];
}

const HEIGHT = 224;
const TOP = 12;
// The band under the plot for the labels, inside the height, so the chart
// never scrolls in its card.
const AXIS = 28;
const RIGHT = 8;
// About how wide a character of the axis is, at 12 pixels.
const CHAR = 7;
// Thin bars: never wider than this, the rest of each band is air.
const MAX_BAR = 24;
// The surface's gap between columns that would touch.
const GAP = 2;
// Room for each label under the columns.
const LABEL_ROOM = 72;

// The width the chart has, followed as its card grows and shrinks. Before
// it is measured, and where it can't be (the tests), 640.
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      setWidth(measured > 0 ? measured : 640);
    };
    measure();
    const watch =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    watch?.observe(element);
    return () => watch?.disconnect();
  }, [ref]);
  return width;
}

// One series over time as thin columns (part 15D, ADR 0047), our own SVG:
// nothing from another site, and only attributes, so the console's policy
// stays as it is. Columns rise from 0, or fall below it for less than
// nothing, on clean gridlines. Under the pointer, a column's numbers show
// in the line above it. For the keyboard, a range hidden over the columns
// takes the focus (the chart shows the ring): the arrow keys, Home and End
// move along it, and screen readers hear each column's numbers as its
// value. The whole series is also a table, a button away. The colours are
// the design system's (series, line, the inks).
export function ColumnChart({
  label,
  columns,
  tableHeaders,
}: {
  // What the chart shows, for screen readers and the table's caption.
  label: string;
  columns: ChartColumn[];
  tableHeaders: string[];
}) {
  const frame = useRef<HTMLDivElement>(null);
  const width = useWidth(frame);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const scale = useMemo(
    () => scaleFor(columns.map((column) => column.value)),
    [columns],
  );
  const format = useMemo(() => tickFormat(scale.ticks), [scale]);
  const left =
    8 + CHAR * Math.max(...scale.ticks.map((tick) => format(tick).length));
  const plotWidth = Math.max(1, width - left - RIGHT);
  const plotHeight = HEIGHT - TOP - AXIS;
  const y = (value: number) =>
    TOP + ((scale.high - value) / (scale.high - scale.low)) * plotHeight;
  const band = plotWidth / Math.max(1, columns.length);
  const barWidth = Math.max(1, Math.min(MAX_BAR, band - GAP));
  const labelled = labelledColumns(
    columns.length,
    Math.floor(plotWidth / LABEL_ROOM),
  );
  const last = columns.length - 1;
  const shown = active !== null && active <= last ? active : null;

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - left) / band);
    setActive(Math.min(last, Math.max(0, index)));
  };
  // The keys move a range over the columns, from the latest when it takes
  // the focus.
  const current = shown ?? last;

  return (
    <figure className="min-w-0">
      <p
        aria-hidden="true"
        className={`min-h-5 text-sm ${shown === null ? 'text-ink-muted' : 'font-medium text-ink'}`}
      >
        {shown === null
          ? 'Point at a column, or use the arrow keys, to see its numbers.'
          : columns[shown]?.readout}
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
            aria-valuetext={columns[current]?.readout}
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
                x2={width - RIGHT}
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
          {columns.map((column, i) => {
            const x = left + i * band + (band - barWidth) / 2;
            const path = columnPath(x, barWidth, y(0), y(column.value));
            return path ? (
              <path
                key={column.key}
                d={path}
                className={i === shown ? 'fill-series-hover' : 'fill-series'}
              />
            ) : null;
          })}
          {columns.map((column, i) => {
            if (!labelled.has(i)) {
              return null;
            }
            const half = (CHAR * column.label.length) / 2;
            const centre = left + (i + 0.5) * band;
            const x = Math.min(
              width - RIGHT - half,
              Math.max(left + half, centre),
            );
            return (
              <text
                key={column.key}
                x={x}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-ink-muted text-xs"
              >
                {column.label}
              </text>
            );
          })}
        </svg>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon={Table2}
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => setShowTable((open) => !open)}
        className="mt-2"
      >
        {showTable ? 'Hide the table' : 'Show as a table'}
      </Button>
      <div
        id={tableId}
        hidden={!showTable}
        className="mt-2 overflow-x-auto rounded-lg border border-line"
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="bg-surface-muted text-xs text-ink-muted">
            <tr>
              {tableHeaders.map((header, i) => (
                <th
                  key={header}
                  scope="col"
                  className={`px-3 py-1.5 font-medium ${i > 0 ? 'text-right' : ''}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {columns.map((column) => (
              <tr key={column.key}>
                {column.cells.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-3 py-1.5 font-medium">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="px-3 py-1.5 text-right tabular-nums">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
