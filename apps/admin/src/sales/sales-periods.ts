import { isDay } from '../stock/batch-forms';

// The periods the Sales page shows (part 15D, ADR 0047), as days in India
// such as 2026-11-25, the first and the last both included. Worked out from
// their digits, so the computer's own time zone never moves one a day.

export interface Period {
  from: string;
  to: string;
}

// As far apart as the API lets the two days be: about ten years.
export const MAX_PERIOD_DAYS = 3660;

const DAY_MS = 86_400_000;

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// How many days a period has: 1 for a single day.
export function daysIn({ from, to }: Period): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

const firstOfMonth = (day: string) => `${day.slice(0, 8)}01`;

export interface Preset {
  name: string;
  label: string;
  of: (today: string) => Period;
}

// The periods a click away. Those that run to today include it: its sales
// show within 5 minutes.
export const PRESETS = [
  {
    name: 'today',
    label: 'Today',
    of: (today) => ({ from: today, to: today }),
  },
  {
    name: 'yesterday',
    label: 'Yesterday',
    of: (today) => {
      const day = addDays(today, -1);
      return { from: day, to: day };
    },
  },
  {
    name: 'last-7-days',
    label: 'Last 7 days',
    of: (today) => ({ from: addDays(today, -6), to: today }),
  },
  {
    name: 'last-30-days',
    label: 'Last 30 days',
    of: (today) => ({ from: addDays(today, -29), to: today }),
  },
  {
    name: 'this-month',
    label: 'This month',
    of: (today) => ({ from: firstOfMonth(today), to: today }),
  },
  {
    name: 'last-month',
    label: 'Last month',
    of: (today) => {
      const end = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(end), to: end };
    },
  },
  {
    name: 'this-year',
    label: 'This year',
    of: (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: today }),
  },
] as const satisfies readonly Preset[];

// The page opens on the last 30 days: a whole month of days to compare.
export const DEFAULT_PRESET: Preset = PRESETS[3];

export type DateField = 'from' | 'to';

// What is wrong with two days typed in, field by field: nothing when they
// make a period the API will show.
export function datesProblems(
  from: string,
  to: string,
): Partial<Record<DateField, string>> {
  const problems: Partial<Record<DateField, string>> = {};
  if (!isDay(from)) {
    problems.from = 'Choose the first day';
  }
  if (!isDay(to)) {
    problems.to = 'Choose the last day';
  }
  if (problems.from || problems.to) {
    return problems;
  }
  if (from > to) {
    problems.to = 'Choose a day on or after the first day';
  } else if (daysIn({ from, to }) > MAX_PERIOD_DAYS) {
    problems.to = `Choose at most ${MAX_PERIOD_DAYS.toLocaleString('en-IN')} days, about 10 years`;
  }
  return problems;
}

export type PeriodChoice =
  | { kind: 'preset'; preset: Preset; period: Period }
  | { kind: 'dates'; period: Period };

// The period the address asks for: two days chosen (from and to), else a
// preset by its name, else the default. Anything the page could not show
// gives the default, as a link from before might.
export function periodChoice(
  params: URLSearchParams,
  today: string,
): PeriodChoice {
  const from = params.get('from');
  const to = params.get('to');
  if (from && to && Object.keys(datesProblems(from, to)).length === 0) {
    return { kind: 'dates', period: { from, to } };
  }
  const preset =
    PRESETS.find((one) => one.name === params.get('period')) ?? DEFAULT_PRESET;
  return { kind: 'preset', preset, period: preset.of(today) };
}
