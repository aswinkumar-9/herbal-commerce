import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET,
  MAX_PERIOD_DAYS,
  PRESETS,
  addDays,
  datesProblems,
  daysIn,
  periodChoice,
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
    });
    expect(PRESETS.map((preset) => preset.label)).toEqual([
      'Today',
      'Yesterday',
      'Last 7 days',
      'Last 30 days',
      'This month',
      'Last month',
      'This year',
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
