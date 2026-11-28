import {
  ChevronRight,
  Minus,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { Link } from 'react-router';
import { count, toneOf } from './sales-display';
import type { Change } from './sales-display';

// The Sales page's figures (part 15D, ADR 0047), shared by its tabs since
// part 15E: a card, a figure beside the period before, and their shapes
// while they load.

export const TILE =
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
export function Figure({
  label,
  value,
  change,
  better = 'up',
  note,
  size = 'md',
  heading: Heading = 'h2',
}: {
  label: string;
  value: string;
  change: Change;
  // Which way is for the better: up, but for refunds.
  better?: 'up' | 'down';
  note?: string;
  size?: 'lg' | 'md';
  // Under a section's heading, a level down (part 15E).
  heading?: 'h2' | 'h3';
}) {
  return (
    <div>
      <Heading className="text-sm font-medium text-ink-muted">{label}</Heading>
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

// A way on from a tile to the list it counts (part 15E).
export const TILE_LINK =
  'mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-focus';

// A count as it stands now, with no period to compare, and a way to the
// list it counts (part 15E): what waits for staff, what is out of stock.
export function LinkTile({
  label,
  value,
  note,
  to,
  linkText,
  alert,
  heading: Heading = 'h2',
}: {
  label: string;
  // A count, or the words for an amount.
  value: number | string;
  note: string;
  to?: string;
  linkText?: string;
  // Something for a Super User to put right: in red, with an icon.
  alert?: boolean;
  heading?: 'h2' | 'h3';
}) {
  return (
    <div className={TILE}>
      <Heading className="text-sm font-medium text-ink-muted">{label}</Heading>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {typeof value === 'number' ? count(value) : value}
      </p>
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
      {to && linkText ? (
        <Link to={to} className={TILE_LINK}>
          {linkText}
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

// Shaped like the figures, while they load.
export function FiguresLoading({ what = 'the sales' }: { what?: string }) {
  return (
    <div className="mt-4">
      <output className="sr-only">Loading {what}…</output>
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
