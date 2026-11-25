import { describe, expect, it } from 'vitest';
import {
  columnPath,
  labelledColumns,
  scaleFor,
  signedRupees,
  tickFormat,
} from './chart-scale';

describe('signedRupees', () => {
  it('groups the Indian way, with a true minus below 0', () => {
    expect(signedRupees(123456)).toBe('₹1,23,456');
    expect(signedRupees(0)).toBe('₹0');
    expect(signedRupees(-428)).toBe('−₹428');
  });
});

describe('tickFormat', () => {
  it('writes an axis in full below ₹10,000, and short the Indian way from it', () => {
    const full = tickFormat([0, 2500, 5000, 7500]);
    expect([0, 2500, 7500].map(full)).toEqual(['₹0', '₹2,500', '₹7,500']);
    const reaching = tickFormat([0, 5000, 10000]);
    expect([0, 5000, 10000].map(reaching)).toEqual(['₹0', '₹5K', '₹10K']);
    const short = tickFormat([-10000, 0, 150000, 10000000]);
    expect([-10000, 0, 1500, 150000, 10000000].map(short)).toEqual([
      '−₹10K',
      '₹0',
      '₹1.5K',
      '₹1.5L',
      '₹1Cr',
    ]);
  });
});

describe('scaleFor', () => {
  it('runs from 0 to a clean number above the most, in clean steps', () => {
    expect(scaleFor([120, 900, 449])).toEqual({
      low: 0,
      high: 1000,
      ticks: [0, 250, 500, 750, 1000],
    });
    expect(scaleFor([3, 7])).toEqual({
      low: 0,
      high: 8,
      ticks: [0, 2, 4, 6, 8],
    });
  });

  it('goes below 0 when a value does, with 0 among the ticks', () => {
    const scale = scaleFor([900, -428]);
    expect(scale.low).toBe(-500);
    expect(scale.high).toBe(1000);
    expect(scale.ticks).toContain(0);
    expect(scale.ticks[0]).toBe(-500);
    expect(scale.ticks.at(-1)).toBe(1000);
  });

  it('gives nothing but 0 an axis of its own', () => {
    expect(scaleFor([0, 0])).toEqual({ low: 0, high: 1, ticks: [0] });
    expect(scaleFor([])).toEqual({ low: 0, high: 1, ticks: [0] });
  });

  it('never steps by less than a rupee', () => {
    expect(scaleFor([1]).ticks).toEqual([0, 1]);
  });
});

describe('columnPath', () => {
  it('rounds a rising column at its top only, square at the baseline', () => {
    expect(columnPath(10, 20, 100, 40)).toBe(
      'M10 100 V44 Q10 40 14 40 H26 Q30 40 30 44 V100 Z',
    );
  });

  it('rounds a falling column at its bottom only', () => {
    expect(columnPath(10, 20, 100, 160)).toBe(
      'M10 100 V156 Q10 160 14 160 H26 Q30 160 30 156 V100 Z',
    );
  });

  it('keeps the rounding inside a thin or a short column, and draws none for 0', () => {
    expect(columnPath(0, 4, 100, 97)).toBe(
      'M0 100 V99 Q0 97 2 97 H2 Q4 97 4 99 V100 Z',
    );
    expect(columnPath(0, 20, 100, 100)).toBeNull();
  });
});

describe('labelledColumns', () => {
  it('labels every column that has room', () => {
    expect([...labelledColumns(5, 10)]).toEqual([0, 1, 2, 3, 4]);
  });

  it('labels every so many, and always the last, never crowding it', () => {
    expect([...labelledColumns(30, 6)].sort((a, b) => a - b)).toEqual([
      0, 5, 10, 15, 20, 29,
    ]);
    expect([...labelledColumns(31, 6)].sort((a, b) => a - b)).toEqual([
      0, 6, 12, 18, 24, 30,
    ]);
  });

  it('labels nothing when there is nothing', () => {
    expect(labelledColumns(0, 6).size).toBe(0);
  });
});
