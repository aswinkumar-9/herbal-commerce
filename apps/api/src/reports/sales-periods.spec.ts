import {
  addDays,
  barOf,
  barsOf,
  daysIn,
  previousPeriod,
  unitFor,
} from './sales-periods';

describe('sales periods', () => {
  it('counts days across months, years and leap days', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysIn('2026-11-25', '2026-11-25')).toBe(1);
    expect(daysIn('2026-01-01', '2026-12-31')).toBe(365);
    expect(daysIn('2028-01-01', '2028-12-31')).toBe(366);
  });

  it('compares with the period of the same length just before', () => {
    expect(previousPeriod('2026-11-01', '2026-11-25')).toEqual({
      from: '2026-10-07',
      to: '2026-10-31',
    });
    expect(previousPeriod('2026-11-25', '2026-11-25')).toEqual({
      from: '2026-11-24',
      to: '2026-11-24',
    });
    // March has 31 days; the 31 before it end with February.
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({
      from: '2026-01-29',
      to: '2026-02-28',
    });
  });

  it('shows days for up to 62 days, weeks for up to 182, then months', () => {
    expect(unitFor('2026-11-01', '2026-11-01')).toBe('day');
    expect(unitFor('2026-10-01', '2026-12-01')).toBe('day'); // 62 days
    expect(unitFor('2026-10-01', '2026-12-02')).toBe('week'); // 63
    expect(unitFor('2026-06-01', '2026-11-29')).toBe('week'); // 182
    expect(unitFor('2026-06-01', '2026-11-30')).toBe('month'); // 183
  });

  it('puts a day in its own bar, its week from Monday, or its month', () => {
    // 25 November 2026 is a Wednesday; the 29th a Sunday.
    expect(barOf('2026-11-25', 'day', '2026-11-01')).toBe('2026-11-25');
    expect(barOf('2026-11-25', 'week', '2026-11-01')).toBe('2026-11-23');
    expect(barOf('2026-11-29', 'week', '2026-11-01')).toBe('2026-11-23');
    expect(barOf('2026-11-30', 'week', '2026-11-01')).toBe('2026-11-30');
    expect(barOf('2026-11-25', 'month', '2026-01-01')).toBe('2026-11-01');
  });

  it('puts a day in its quarter from January, April, July or October, and its financial year from April', () => {
    const from = '2020-01-01';
    expect(barOf('2026-03-31', 'quarter', from)).toBe('2026-01-01');
    expect(barOf('2026-04-01', 'quarter', from)).toBe('2026-04-01');
    expect(barOf('2026-09-30', 'quarter', from)).toBe('2026-07-01');
    expect(barOf('2026-12-31', 'quarter', from)).toBe('2026-10-01');
    // The financial year 2025–26 runs from 1 April 2025 to 31 March 2026.
    expect(barOf('2026-03-31', 'year', from)).toBe('2025-04-01');
    expect(barOf('2026-04-01', 'year', from)).toBe('2026-04-01');
    expect(barOf('2026-01-01', 'year', from)).toBe('2025-04-01');
    expect(barOf('2026-12-31', 'year', from)).toBe('2026-04-01');
  });

  it('starts the first bar with the period, never before it', () => {
    expect(barOf('2026-11-25', 'week', '2026-11-24')).toBe('2026-11-24');
    expect(barOf('2026-11-25', 'month', '2026-11-15')).toBe('2026-11-15');
    expect(barOf('2026-11-25', 'quarter', '2026-11-15')).toBe('2026-11-15');
    expect(barOf('2026-11-25', 'year', '2026-05-01')).toBe('2026-05-01');
  });

  it('lists every bar of a period, in order', () => {
    expect(barsOf('2026-11-24', '2026-11-26', 'day')).toEqual([
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
    ]);
    expect(barsOf('2026-11-24', '2026-12-08', 'week')).toEqual([
      '2026-11-24',
      '2026-11-30',
      '2026-12-07',
    ]);
    expect(barsOf('2026-01-15', '2026-03-02', 'month')).toEqual([
      '2026-01-15',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect(barsOf('2025-12-01', '2026-07-01', 'quarter')).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
    ]);
    expect(barsOf('2024-03-01', '2026-11-27', 'year')).toEqual([
      '2024-03-01',
      '2024-04-01',
      '2025-04-01',
      '2026-04-01',
    ]);
  });
});
