// The periods of the sales report (ADR 0047), as plain functions of days in
// India written "2026-11-25", so they are easy to test. Such days compare
// correctly as text.

const DAY_MS = 24 * 60 * 60 * 1000;

// About ten years: any range a Super User picks, within reason.
export const MAX_PERIOD_DAYS = 3660;

// A day as the database's DATE columns take it and give it: midnight UTC.
export const dateOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
export const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

export const addDays = (day: string, days: number): string =>
  dayOf(new Date(dateOf(day).getTime() + days * DAY_MS));

// How many days a period has, both ends included.
export const daysIn = (from: string, to: string): number =>
  Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / DAY_MS) + 1;

// The period of the same length just before: what the totals compare with.
export function previousPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const end = addDays(from, -1);
  return { from: addDays(end, 1 - daysIn(from, to)), to: end };
}

export const SERIES_UNITS = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;
export type SeriesUnit = (typeof SERIES_UNITS)[number];

// At most this many bars in a chart: a year of days. A longer period takes
// bigger bars.
export const MAX_BARS = 366;

// The chart shows each day for up to about two months, each week for up to
// about six, and each month for anything longer.
export function unitFor(from: string, to: string): SeriesUnit {
  const days = daysIn(from, to);
  return days <= 62 ? 'day' : days <= 182 ? 'week' : 'month';
}

// The first day of the bar a day falls in: the day itself, the Monday of
// its week, the first of its month or of its quarter (January, April, July
// or October), or the 1st of April of its financial year, as Indian
// accounts keep them (the owner's choice, 2026-11-27). Never before the
// period starts.
export function barOf(day: string, unit: SeriesUnit, from: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  let start = day;
  if (unit === 'week') {
    const sinceMonday = (dateOf(day).getUTCDay() + 6) % 7;
    start = addDays(day, -sinceMonday);
  } else if (unit === 'month') {
    start = `${day.slice(0, 7)}-01`;
  } else if (unit === 'quarter') {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    start = `${day.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
  } else if (unit === 'year') {
    start = `${month >= 4 ? year : year - 1}-04-01`;
  }
  return start < from ? from : start;
}

// The first day of every bar in the period, in order.
export function barsOf(from: string, to: string, unit: SeriesUnit): string[] {
  const bars: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const bar = barOf(day, unit, from);
    if (bars.at(-1) !== bar) {
      bars.push(bar);
    }
  }
  return bars;
}
