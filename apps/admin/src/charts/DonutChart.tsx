import { useState } from 'react';
import { PICK_BUTTON } from './BarList';
import { arcPath, shareName } from './chart-scale';

// The design system's colours for parts of a whole (part 15E): seven hues,
// each a part's own wherever it shows, and grey for what was not recorded.
// Written out, so the stylesheet has each one.
export type PartColour = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 'other';
const FILLS: Record<PartColour, string> = {
  1: 'fill-series-1',
  2: 'fill-series-2',
  3: 'fill-series-3',
  4: 'fill-series-4',
  5: 'fill-series-5',
  6: 'fill-series-6',
  7: 'fill-series-7',
  other: 'fill-series-other',
};
// A part alone is a whole circle's stroke.
const STROKES: Record<PartColour, string> = {
  1: 'stroke-series-1',
  2: 'stroke-series-2',
  3: 'stroke-series-3',
  4: 'stroke-series-4',
  5: 'stroke-series-5',
  6: 'stroke-series-6',
  7: 'stroke-series-7',
  other: 'stroke-series-other',
};
const SWATCHES: Record<PartColour, string> = {
  1: 'bg-series-1',
  2: 'bg-series-2',
  3: 'bg-series-3',
  4: 'bg-series-4',
  5: 'bg-series-5',
  6: 'bg-series-6',
  7: 'bg-series-7',
  other: 'bg-series-other',
};

export interface DonutPart {
  key: string;
  name: string;
  // Its size: never below 0.
  value: number;
  colour: PartColour;
  // Its figures, in the legend: "₹1,170 from 3 orders".
  figure: string;
  // Whether choosing it means something (part 15E).
  pickable?: boolean;
}

const SIZE = 176;
const OUTER = SIZE / 2;
// A thin ring: the parts are read by their angles and the legend, not by
// a filled pie.
const INNER = OUTER - 20;
// The card's colour between parts, as wide as between columns.
const GAP = 2;

// One whole split into a few parts as a ring (part 15E, the owner's choice
// on 2026-11-27), for a share read at a glance, beside the figures that
// say it exactly. The parts keep the order they are given, each its own
// colour, so a part never changes colour or place when another comes or
// goes; a 2-pixel gap of the card's colour parts each from the next. The
// whole is written in the middle. The legend lists every part with its
// figures and its share, so the drawing hides nothing and is itself hidden
// from screen readers. Pointing at a part, or at its row, picks out both.
// For parts that can be below 0, or for more than six, use bars instead.
// Given `onPick`, each pickable part's name in the legend is a button that
// is pressed while it is chosen.
export function DonutChart({
  label,
  parts,
  total,
  onPick,
  picked,
}: {
  // What the chart shows: the legend's name for screen readers.
  label: string;
  parts: DonutPart[];
  // In the middle: "₹2,450", and what it is, "in sales".
  total: { value: string; caption: string };
  onPick?: (part: DonutPart) => void;
  picked?: (part: DonutPart) => boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const whole = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  const drawn = parts.filter((part) => part.value > 0);

  // Each drawn part's angles, clockwise from 12 o'clock.
  const pieces = drawn.reduce<{ part: DonutPart; from: number; to: number }[]>(
    (list, part) => {
      const from = list.at(-1)?.to ?? 0;
      list.push({ part, from, to: from + (part.value / whole) * 2 * Math.PI });
      return list;
    },
    [],
  );

  const fade = (key: string) =>
    active !== null && active !== key ? 'opacity-40' : '';

  return (
    <figure className="flex min-w-0 flex-col items-center gap-4">
      <svg
        aria-hidden="true"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0"
        onPointerLeave={() => setActive(null)}
      >
        {whole <= 0 ? (
          <circle
            cx={OUTER}
            cy={OUTER}
            r={(OUTER + INNER) / 2}
            fill="none"
            strokeWidth={OUTER - INNER}
            className="stroke-surface-muted"
          />
        ) : pieces.length === 1 && pieces[0] ? (
          <circle
            data-part={pieces[0].part.key}
            cx={OUTER}
            cy={OUTER}
            r={(OUTER + INNER) / 2}
            fill="none"
            strokeWidth={OUTER - INNER}
            className={STROKES[pieces[0].part.colour]}
            onPointerEnter={() => setActive(pieces[0]?.part.key ?? null)}
          />
        ) : (
          pieces.map(({ part, from, to }) => (
            <path
              key={part.key}
              data-part={part.key}
              d={arcPath(OUTER, OUTER, OUTER, INNER, from, to)}
              strokeWidth={GAP}
              strokeLinejoin="round"
              className={`stroke-surface transition-opacity duration-150 ${FILLS[part.colour]} ${fade(part.key)}`}
              onPointerEnter={() => setActive(part.key)}
            />
          ))
        )}
        <text
          x={OUTER}
          y={OUTER - 2}
          textAnchor="middle"
          className="fill-ink text-xl font-semibold tabular-nums"
        >
          {total.value}
        </text>
        <text
          x={OUTER}
          y={OUTER + 16}
          textAnchor="middle"
          className="fill-ink-muted text-xs"
        >
          {total.caption}
        </text>
      </svg>
      <ul aria-label={label} className="w-full min-w-0 space-y-1 text-sm">
        {parts.map((part) => (
          <li
            key={part.key}
            onPointerEnter={() => setActive(part.key)}
            onPointerLeave={() => setActive(null)}
            className={`flex items-start gap-2 rounded-lg px-2 py-1 transition-colors duration-150 ${active === part.key ? 'bg-surface-muted' : ''}`}
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2.5 shrink-0 rounded-sm ${SWATCHES[part.colour]}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block break-words text-ink">
                {onPick && part.pickable ? (
                  <button
                    type="button"
                    aria-pressed={picked?.(part) ?? false}
                    onClick={() => onPick(part)}
                    className={PICK_BUTTON}
                  >
                    {part.name}
                  </button>
                ) : (
                  part.name
                )}
              </span>
              <span className="block text-xs text-ink-muted tabular-nums">
                {part.figure}
              </span>
            </span>
            <span className="shrink-0 text-right font-medium tabular-nums">
              {shareName(Math.max(0, part.value), whole)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
