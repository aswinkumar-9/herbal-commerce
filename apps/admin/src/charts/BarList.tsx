import type { ReactNode } from 'react';

export interface BarListItem {
  key: string;
  name: ReactNode;
  value: number;
  // The value as people read it: "₹1,350".
  figure: string;
  // Quieter, after the figure: "3 orders".
  note?: string;
  // Shown under it, a little in, on the same scale: a category's
  // subcategories.
  children?: BarListItem[];
}

// Where 0 sits on the bars, and how far each value reaches, in percent of
// the width: from the left edge, or further in when a value is below 0.
function reachOf(items: readonly BarListItem[]) {
  const values = items.flatMap((item) => [
    item.value,
    ...(item.children ?? []).map((child) => child.value),
  ]);
  const least = Math.min(0, ...values);
  const most = Math.max(0, ...values);
  const span = most - least || 1;
  const zero = (-least / span) * 100;
  return {
    hasNegative: least < 0,
    zero,
    bar: (value: number) => {
      const end = zero + (value / span) * 100;
      return { x: Math.min(zero, end), width: Math.abs(end - zero) };
    },
  };
}

// A ranked list as thin bars (part 15D, ADR 0047): each row its name and
// figure, its bar under them on one shared scale, so rows compare at a
// glance. One colour, as the rows are one series; every figure is printed,
// so nothing is told by colour alone. Our own SVG, attributes only. A value
// below 0 reaches left of a zero line.
export function BarList({
  label,
  items,
}: {
  // What the list ranks, for screen readers.
  label: string;
  items: BarListItem[];
}) {
  const reach = reachOf(items);
  const row = (item: BarListItem, nested: boolean) => {
    const { x, width } = reach.bar(item.value);
    return (
      <li key={item.key} className={nested ? 'pl-4' : ''}>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span
            className={`min-w-0 truncate ${nested ? 'text-ink-muted' : 'font-medium'}`}
          >
            {item.name}
          </span>
          <span className="shrink-0 tabular-nums">
            <span className="font-medium">{item.figure}</span>
            {item.note ? (
              <span className="text-ink-muted"> · {item.note}</span>
            ) : null}
          </span>
        </div>
        <svg aria-hidden="true" width="100%" height={8} className="mt-1 block">
          {reach.hasNegative ? (
            <rect
              x={`${reach.zero}%`}
              y={0}
              width={1}
              height={8}
              className="fill-line-strong"
            />
          ) : null}
          {width > 0 ? (
            <rect
              x={`${x}%`}
              y={nested ? 2 : 0}
              width={`${width}%`}
              height={nested ? 4 : 8}
              rx={nested ? 2 : 4}
              className="fill-series"
            />
          ) : null}
        </svg>
        {item.children && item.children.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {item.children.map((child) => row(child, true))}
          </ul>
        ) : null}
      </li>
    );
  };
  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((item) => row(item, false))}
    </ul>
  );
}
