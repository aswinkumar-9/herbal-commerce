import { describe, expect, it } from 'vitest';
import { signedRupees } from '../charts/chart-scale';
import {
  averageChange,
  changeFrom,
  count,
  counted,
  periodBefore,
  periodName,
  updatedName,
} from './sales-display';

describe('the period before', () => {
  it('has the same number of days and ends the day before', () => {
    expect(periodBefore({ from: '2026-11-01', to: '2026-11-25' })).toEqual({
      from: '2026-10-07',
      to: '2026-10-31',
    });
    expect(periodBefore({ from: '2026-11-25', to: '2026-11-25' })).toEqual({
      from: '2026-11-24',
      to: '2026-11-24',
    });
    expect(periodBefore({ from: '2028-03-01', to: '2028-03-31' })).toEqual({
      from: '2028-01-30',
      to: '2028-02-29',
    });
  });
});

describe('a period’s name', () => {
  it('says the year once, and the month once when it is the same', () => {
    expect(periodName({ from: '2026-11-25', to: '2026-11-25' })).toBe(
      '25 Nov 2026',
    );
    expect(periodName({ from: '2026-11-01', to: '2026-11-25' })).toBe(
      '1–25 Nov 2026',
    );
    expect(periodName({ from: '2026-10-07', to: '2026-11-05' })).toBe(
      '7 Oct – 5 Nov 2026',
    );
    expect(periodName({ from: '2025-12-15', to: '2026-01-10' })).toBe(
      '15 Dec 2025 – 10 Jan 2026',
    );
  });
});

describe('how a figure moved', () => {
  it('is a share of the period before, when that had some', () => {
    expect(changeFrom(1150, 1000, signedRupees)).toEqual({
      direction: 'up',
      words: 'Up 15% from ₹1,000',
    });
    expect(changeFrom(250, 1000, signedRupees)).toEqual({
      direction: 'down',
      words: 'Down 75% from ₹1,000',
    });
    expect(changeFrom(12_500, 1000, signedRupees).words).toBe(
      'Up 1,150% from ₹1,000',
    );
    expect(changeFrom(1001, 1000, signedRupees).words).toBe(
      'Up less than 1% from ₹1,000',
    );
    expect(changeFrom(3, 2, count).words).toBe('Up 50% from 2');
  });

  it('is how much, from nothing or from less than nothing', () => {
    expect(changeFrom(1374, 0, signedRupees)).toEqual({
      direction: 'up',
      words: 'Up ₹1,374 from ₹0',
    });
    expect(changeFrom(1200, -428, signedRupees)).toEqual({
      direction: 'up',
      words: 'Up ₹1,628 from −₹428',
    });
    expect(changeFrom(-428, 0, signedRupees)).toEqual({
      direction: 'down',
      words: 'Down ₹428 from ₹0',
    });
    expect(changeFrom(-900, -428, signedRupees).words).toBe(
      'Down ₹472 from −₹428',
    );
    // Down past 0: not a share of what it was.
    expect(changeFrom(-428, 1374, signedRupees)).toEqual({
      direction: 'down',
      words: 'Down ₹1,802 from ₹1,374',
    });
    expect(changeFrom(0, 1374, signedRupees).words).toBe(
      'Down 100% from ₹1,374',
    );
    expect(changeFrom(4, 0, count).words).toBe('Up 4 from 0');
  });

  it('says when it did not move', () => {
    expect(changeFrom(900, 900, signedRupees)).toEqual({
      direction: 'same',
      words: 'Same as before, ₹900',
    });
    expect(changeFrom(0, 0, count).words).toBe('Same as before, 0');
  });

  it('copes with periods that had no orders to average', () => {
    expect(averageChange(451, 400).words).toBe('Up 13% from ₹400');
    expect(averageChange(451, null)).toEqual({
      direction: 'none',
      words: 'No orders before',
    });
    expect(averageChange(null, 400)).toEqual({
      direction: 'none',
      words: '₹400 before',
    });
    expect(averageChange(null, null)).toEqual({
      direction: 'none',
      words: 'No orders before either',
    });
  });
});

describe('words', () => {
  it('count in the Indian way', () => {
    expect(count(125_000)).toBe('1,25,000');
    expect(counted(1, 'order', 'orders')).toBe('1 order');
    expect(counted(0, 'order', 'orders')).toBe('0 orders');
    expect(counted(1500, 'order', 'orders')).toBe('1,500 orders');
  });

  it('say when the figures were worked out, in India', () => {
    expect(updatedName('2026-11-25T06:40:00.000Z', '2026-11-25')).toBe(
      'today at 12:10',
    );
    // 23:55 on the 24th in India; the new day starts at 18:30 UTC.
    expect(updatedName('2026-11-24T18:25:00.000Z', '2026-11-25')).toBe(
      '24 Nov 2026, 23:55',
    );
    expect(updatedName('2026-11-24T18:30:00.000Z', '2026-11-25')).toBe(
      'today at 00:00',
    );
  });
});
