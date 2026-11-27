import { describe, expect, it } from 'vitest';
import {
  arcPath,
  columnPath,
  heatBounds,
  heatStep,
  labelledColumns,
  linePath,
  scaleFor,
  shareName,
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

describe('linePath', () => {
  it('moves to the first point and draws to each next, rounded to a hundredth', () => {
    expect(
      linePath([
        { x: 10, y: 20 },
        { x: 30.123, y: 5.006 },
        { x: 50, y: 40 },
      ]),
    ).toBe('M10 20 L30.12 5.01 L50 40');
    expect(linePath([{ x: 1, y: 2 }])).toBe('M1 2');
    expect(linePath([])).toBeNull();
  });
});

describe('arcPath', () => {
  it('draws a piece of a ring clockwise from 12 o’clock, the long way round only past half', () => {
    // A quarter, from 12 to 3 o'clock, of a ring between 80 and 60.
    expect(arcPath(100, 100, 80, 60, 0, Math.PI / 2)).toBe(
      'M100 20 A80 80 0 0 1 180 100 L160 100 A60 60 0 0 0 100 40 Z',
    );
    // Three quarters goes the long way.
    expect(arcPath(100, 100, 80, 60, 0, (3 * Math.PI) / 2)).toContain(
      'A80 80 0 1 1',
    );
  });
});

describe('shareName', () => {
  it('says a share in whole percent, a tiny one as less than 1%', () => {
    expect(shareName(62, 100)).toBe('62%');
    expect(shareName(2, 3)).toBe('67%');
    expect(shareName(1, 1000)).toBe('less than 1%');
    expect(shareName(5, 1000)).toBe('1%');
    expect(shareName(0, 100)).toBe('0%');
    expect(shareName(5, 0)).toBe('0%');
  });
});

describe('a calendar’s steps', () => {
  it('tops each of four steps at a quarter more of the most sold in a day', () => {
    expect(heatBounds(1000)).toEqual([250, 500, 750, 1000]);
    expect(heatBounds(1001)).toEqual([251, 501, 751, 1001]);
    expect(heatBounds(0)).toEqual([0, 0, 0, 0]);
  });

  it('puts nothing sold, or less, in no step, and each day in the first step it doesn’t pass', () => {
    const bounds = heatBounds(1000);
    expect(heatStep(0, bounds)).toBe(0);
    expect(heatStep(-428, bounds)).toBe(0);
    expect(heatStep(1, bounds)).toBe(1);
    expect(heatStep(250, bounds)).toBe(1);
    expect(heatStep(251, bounds)).toBe(2);
    expect(heatStep(750, bounds)).toBe(3);
    expect(heatStep(751, bounds)).toBe(4);
    expect(heatStep(1000, bounds)).toBe(4);
    // Above the top, as a day added later could be: the last step.
    expect(heatStep(5000, bounds)).toBe(4);
    // A small most still keeps every day it holds.
    expect(heatStep(1, heatBounds(1))).toBe(1);
  });
});
