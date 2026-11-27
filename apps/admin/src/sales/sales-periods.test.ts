import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET,
  MAX_BARS,
  MAX_PERIOD_DAYS,
  PRESETS,
  addDays,
  barStart,
  barsIn,
  datesProblems,
  daysIn,
  financialYearOf,
  periodChoice,
  unitChoice,
} from './sales-periods';

const presets = (today: string) =>
  Object.fromEntries(PRESETS.map((preset) => [preset.name, preset.of(today)]));

describe('the periods a click away', () => {
  it('run to today, those that end there including it', () => {
    expect(presets('2026-11-25')).toEqual({
      today: { from: '2026-11-25', to: '2026-11-25' },
      yesterday: { from: '2026-11-24', to: '2026-11-24' },
      'last-7-days': { from: '2026-11-19', to: '2026-11-25' },
      'last-30-days': { from: '2026-10-27', to: '2026-11-25' },
      'this-month': { from: '2026-11-01', to: '2026-11-25' },
      'last-month': { from: '2026-10-01', to: '2026-10-31' },
      'this-year': { from: '2026-01-01', to: '2026-11-25' },
      'this-financial-year': { from: '2026-04-01', to: '2026-11-25' },
    });
    expect(PRESETS.map((preset) => preset.label)).toEqual([
      'Today',
      'Yesterday',
      'Last 7 days',
      'Last 30 days',
      'This month',
      'Last month',
      'This year',
      'This financial year',
    ]);
    expect(DEFAULT_PRESET.name).toBe('last-30-days');
  });

  it('cross months and years as the calendar does', () => {
    expect(presets('2026-01-01')).toMatchObject({
      yesterday: { from: '2025-12-31', to: '2025-12-31' },
      'last-7-days': { from: '2025-12-26', to: '2026-01-01' },
      'this-month': { from: '2026-01-01', to: '2026-01-01' },
      'last-month': { from: '2025-12-01', to: '2025-12-31' },
      'this-year': { from: '2026-01-01', to: '2026-01-01' },
      // January is in the financial year that began last April.
      'this-financial-year': { from: '2025-04-01', to: '2026-01-01' },
    });
    expect(presets('2026-04-01')['this-financial-year']).toEqual({
      from: '2026-04-01',
      to: '2026-04-01',
    });
    expect(presets('2027-03-31')['this-financial-year']).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
    });
    expect(presets('2028-03-10')['last-month']).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(presets('2026-03-01')['last-30-days']).toEqual({
      from: '2026-01-31',
      to: '2026-03-01',
    });
  });
});

describe('days', () => {
  it('are counted with both ends included', () => {
    expect(daysIn({ from: '2026-11-25', to: '2026-11-25' })).toBe(1);
    expect(daysIn({ from: '2026-11-01', to: '2026-11-25' })).toBe(25);
    expect(daysIn({ from: '2028-01-01', to: '2028-12-31' })).toBe(366);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('two days typed in', () => {
  it('must both be real days', () => {
    expect(datesProblems('', '')).toEqual({
      from: 'Choose the first day',
      to: 'Choose the last day',
    });
    expect(datesProblems('2027-02-29', '2027-03-01')).toEqual({
      from: 'Choose the first day',
    });
    expect(datesProblems('2026-11-01', '2026-11-25')).toEqual({});
    expect(datesProblems('2026-11-25', '2026-11-25')).toEqual({});
  });

  it('must not end before they start, nor be more than about 10 years apart', () => {
    expect(datesProblems('2026-11-25', '2026-11-24')).toEqual({
      to: 'Choose a day on or after the first day',
    });
    expect(MAX_PERIOD_DAYS).toBe(3660);
    expect(datesProblems('2016-11-18', '2026-11-25')).toEqual({});
    expect(datesProblems('2016-11-17', '2026-11-25')).toEqual({
      to: 'Choose at most 3,660 days, about 10 years',
    });
  });
});

describe('the period in the address', () => {
  const today = '2026-11-25';
  const choose = (search: string) =>
    periodChoice(new URLSearchParams(search), today);

  it('is two days chosen, when they make a period', () => {
    expect(choose('from=2026-11-01&to=2026-11-10')).toEqual({
      kind: 'dates',
      period: { from: '2026-11-01', to: '2026-11-10' },
    });
    // Days chosen win over a preset's name.
    expect(choose('period=today&from=2026-11-01&to=2026-11-10').kind).toBe(
      'dates',
    );
  });

  it('else a preset by its name, else the last 30 days', () => {
    expect(choose('period=this-year')).toMatchObject({
      kind: 'preset',
      preset: { name: 'this-year' },
      period: { from: '2026-01-01', to: today },
    });
    for (const search of [
      '',
      'period=someday',
      'from=2026-11-01',
      'from=2026-11-10&to=2026-11-01',
      'from=2026-02-30&to=2026-03-01',
    ]) {
      expect(choose(search)).toEqual({
        kind: 'preset',
        preset: DEFAULT_PRESET,
        period: { from: '2026-10-27', to: today },
      });
    }
  });
});

describe('the bars of the chart', () => {
  it('start a financial year on the 1st of April', () => {
    expect(financialYearOf('2026-11-27')).toBe('2026-04-01');
    expect(financialYearOf('2026-04-01')).toBe('2026-04-01');
    expect(financialYearOf('2026-03-31')).toBe('2025-04-01');
    expect(financialYearOf('2027-01-15')).toBe('2026-04-01');
  });

  it('start each bar as the API does, never before the period', () => {
    // 25 November 2026 is a Wednesday.
    expect(barStart('2026-11-25', 'day', '2026-01-01')).toBe('2026-11-25');
    expect(barStart('2026-11-25', 'week', '2026-01-01')).toBe('2026-11-23');
    expect(barStart('2026-11-25', 'month', '2026-01-01')).toBe('2026-11-01');
    expect(barStart('2026-11-25', 'quarter', '2026-01-01')).toBe('2026-10-01');
    expect(barStart('2026-03-31', 'quarter', '2026-01-01')).toBe('2026-01-01');
    expect(barStart('2026-11-25', 'year', '2020-01-01')).toBe('2026-04-01');
    expect(barStart('2026-02-25', 'year', '2020-01-01')).toBe('2025-04-01');
    expect(barStart('2026-11-25', 'week', '2026-11-24')).toBe('2026-11-24');
    expect(barStart('2026-11-25', 'year', '2026-10-01')).toBe('2026-10-01');
  });

  it('count the bars of a period in each size', () => {
    const november = { from: '2026-11-01', to: '2026-11-30' };
    expect(barsIn(november, 'day')).toBe(30);
    // From Sunday the 1st: that day, then four Mondays and the 30th's.
    expect(barsIn(november, 'week')).toBe(6);
    expect(barsIn(november, 'month')).toBe(1);
    const years = { from: '2025-01-01', to: '2026-11-25' };
    expect(barsIn(years, 'quarter')).toBe(8);
    expect(barsIn(years, 'year')).toBe(3);
    expect(barsIn({ from: '2024-01-01', to: '2024-12-31' }, 'day')).toBe(
      MAX_BARS,
    );
  });

  it('take the size the address asks for, unless the period has too many', () => {
    const year = { from: '2024-01-01', to: '2024-12-31' };
    const asked = (unit: string) => new URLSearchParams({ unit });
    expect(unitChoice(asked('day'), year)).toBe('day');
    expect(unitChoice(asked('quarter'), year)).toBe('quarter');
    expect(
      unitChoice(asked('day'), { from: '2024-01-01', to: '2025-01-01' }),
    ).toBeUndefined();
    expect(unitChoice(asked('hour'), year)).toBeUndefined();
    expect(unitChoice(new URLSearchParams(), year)).toBeUndefined();
  });
});
