import { describe, expect, it } from 'vitest';
import { LOW, OUT, PLENTY } from '../test/stock-fixtures';
import type { StockSummary } from './stock-api';
import { dayName, packs, stockCounts } from './stock-display';

describe('stock on screen', () => {
  it.each([
    ['2026-12-01', '1 Dec 2026'],
    ['2027-01-31', '31 Jan 2027'],
    ['2028-09-30', '30 Sep 2028'],
    ['2028-02-29', '29 Feb 2028'],
  ])('reads the label day %s as %s', (day, name) => {
    expect(dayName(day)).toBe(name);
  });

  it('counts packs, grouped the Indian way', () => {
    expect(packs(0)).toBe('0 packs');
    expect(packs(1)).toBe('1 pack');
    expect(packs(150000)).toBe('1,50,000 packs');
  });

  it('says only what the packs are doing', () => {
    expect(stockCounts(LOW as StockSummary)).toBe('4 packs may be sold');
    expect(stockCounts(OUT as StockSummary)).toBe('0 packs may be sold');
    expect(stockCounts(PLENTY as StockSummary)).toBe(
      '40 packs may be sold · 2 packs for orders to pack · 1 pack packed for shipping',
    );
    expect(stockCounts({ ...(OUT as StockSummary), free: 1, packed: 3 })).toBe(
      '0 packs may be sold · 1 pack too near expiry to sell · 3 packs packed for shipping',
    );
  });
});
