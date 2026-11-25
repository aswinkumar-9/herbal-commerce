import { signedRupees } from '../charts/chart-scale';
import { dayName, momentName } from '../stock/stock-display';
import { addDays, daysIn } from './sales-periods';
import type { Period } from './sales-periods';

// How the Sales page says its periods and figures (part 15D, ADR 0047).

// The period of the same length just before, as the API compares with.
export function periodBefore(period: Period): Period {
  return {
    from: addDays(period.from, -daysIn(period)),
    to: addDays(period.from, -1),
  };
}

const withoutYear = (day: string) => dayName(day).replace(/ \d{4}$/, '');

// "25 Nov 2026", "1–25 Nov 2026", "7 Oct – 5 Nov 2026",
// "15 Dec 2025 – 10 Jan 2026".
export function periodName({ from, to }: Period): string {
  if (from === to) {
    return dayName(from);
  }
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${Number(from.slice(8))}–${dayName(to)}`;
  }
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${withoutYear(from)} – ${dayName(to)}`;
  }
  return `${dayName(from)} – ${dayName(to)}`;
}

// "1 order", "1,250 orders".
export function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? one : many}`;
}

export const count = (value: number) => value.toLocaleString('en-IN');

export type Direction = 'up' | 'down' | 'same' | 'none';

export interface Change {
  direction: Direction;
  words: string;
}

// How a figure moved since the period before: by what share of it, when it
// was above 0 and still is not below, else by how much (a share of 0, of
// less, or down past 0 means nothing). "Up 15% from ₹10,435", "Up ₹1,628
// from −₹428", "Down ₹1,802 from ₹1,374", "Same as before, 3".
export function changeFrom(
  now: number,
  before: number,
  show: (value: number) => string,
): Change {
  if (now === before) {
    return { direction: 'same', words: `Same as before, ${show(before)}` };
  }
  const direction = now > before ? 'up' : 'down';
  const word = direction === 'up' ? 'Up' : 'Down';
  const by = Math.abs(now - before);
  if (before > 0 && now >= 0) {
    const share = Math.round((by / before) * 100);
    const shown = share === 0 ? 'less than 1' : share.toLocaleString('en-IN');
    return { direction, words: `${word} ${shown}% from ${show(before)}` };
  }
  return { direction, words: `${word} ${show(by)} from ${show(before)}` };
}

// The same for the average order, which a period without orders has none
// of.
export function averageChange(
  now: number | null,
  before: number | null,
): Change {
  if (before === null) {
    return {
      direction: 'none',
      words: now === null ? 'No orders before either' : 'No orders before',
    };
  }
  if (now === null) {
    return { direction: 'none', words: `${signedRupees(before)} before` };
  }
  return changeFrom(now, before, signedRupees);
}

// When the figures were last worked out, in India: "today at 12:10", else
// with its day, "24 Nov 2026, 23:55".
export function updatedName(at: string, today: string): string {
  const india = new Date(Date.parse(at) + 330 * 60_000).toISOString();
  return india.slice(0, 10) === today
    ? `today at ${india.slice(11, 16)}`
    : momentName(at);
}
