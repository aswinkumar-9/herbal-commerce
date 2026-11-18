import type { StockLevel, StockSummary } from './stock-api';

// How stock reads on screen (ADR 0034).

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// A label's day as staff read it: 2026-12-01 is "1 Dec 2026". Read from
// its digits, so the computer's time zone never moves it a day.
export function dayName(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return `${date} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

// "1 pack", "1,500 packs".
export function packs(count: number): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? 'pack' : 'packs'}`;
}

export const LEVEL_NAMES: Record<StockLevel, string> = {
  OUT: 'Out of stock',
  LOW: 'Low',
  OK: 'In stock',
};

// What a pack size's packs are doing: those that may be sold, those in
// batches too near expiry to sell, and those orders took but have not
// shipped.
export function stockCounts(stock: StockSummary): string {
  const parts = [`${packs(stock.sellable)} may be sold`];
  const tooNear = stock.free - stock.sellable;
  if (tooNear > 0) {
    parts.push(`${packs(tooNear)} too near expiry to sell`);
  }
  if (stock.awaitingPacking > 0) {
    parts.push(`${packs(stock.awaitingPacking)} for orders to pack`);
  }
  if (stock.packed > 0) {
    parts.push(`${packs(stock.packed)} packed for shipping`);
  }
  return parts.join(' · ');
}
