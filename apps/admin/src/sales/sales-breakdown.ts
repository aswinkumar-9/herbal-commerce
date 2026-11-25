import type { BarListItem } from '../charts/BarList';
import type { ChartColumn } from '../charts/ColumnChart';
import { signedRupees } from '../charts/chart-scale';
import { dayName } from '../stock/stock-display';
import type { PaymentMethod, SalesReport } from './sales-api';
import { periodName } from './sales-display';
import { addDays } from './sales-periods';

// The report's series and lists, as the Sales page's chart and bars draw
// them (part 15D, ADR 0047).

type Unit = SalesReport['series']['unit'];

export const UNIT_NAMES: Record<Unit, { title: string; header: string }> = {
  day: { title: 'Sales each day', header: 'Day' },
  week: { title: 'Sales each week', header: 'Week' },
  month: { title: 'Sales each month', header: 'Month' },
};

// "3 Nov" under a day or a week (its first day), "Nov 2026" under a month.
function columnLabel(unit: Unit, start: string): string {
  const name = dayName(start);
  return unit === 'month'
    ? name.replace(/^\d+ /, '')
    : name.replace(/ \d{4}$/, '');
}

// "1 order", "−2 packs": counts that refunds can take below 0.
export function signedCount(value: number, one: string, many: string) {
  const amount = Math.abs(value).toLocaleString('en-IN');
  return `${value < 0 ? '−' : ''}${amount} ${Math.abs(value) === 1 ? one : many}`;
}

// A column for each day, week or month. Each runs to the day before the
// next, and the last to the period's end, so the first and the last week or
// month say the days they really cover.
export function seriesColumns(report: SalesReport): ChartColumn[] {
  const { unit, points } = report.series;
  return points.map((point, i) => {
    const next = points[i + 1];
    const days = periodName({
      from: point.start,
      to: next ? addDays(next.start, -1) : report.period.to,
    });
    const sales = signedRupees(point.salesRupees);
    const orders = signedCount(point.orders, 'order', 'orders');
    return {
      key: point.start,
      label: columnLabel(unit, point.start),
      value: point.salesRupees,
      readout: `${days}: ${sales} from ${orders}`,
      cells: [days, sales, point.orders.toLocaleString('en-IN')],
    };
  });
}

export const METHOD_NAMES: Record<PaymentMethod, string> = {
  UPI: 'UPI',
  CARD: 'Card',
  NETBANKING: 'Net banking',
  WALLET: 'Wallet',
  EMI: 'EMI',
  PAY_LATER: 'Pay later',
  OTHER: 'Other',
};

// Sold before part 15C, when nothing more was kept.
export const NOT_RECORDED = 'Not recorded';

const orders = (count: number) => signedCount(count, 'order', 'orders');

export function productItems(report: SalesReport): BarListItem[] {
  return report.products.map((product) => ({
    key: product.productId ?? `name:${product.name}`,
    name: product.name,
    value: product.salesRupees,
    figure: signedRupees(product.salesRupees),
    note: signedCount(product.packs, 'pack', 'packs'),
  }));
}

// Each category with its subcategories under it: its own sales include
// theirs.
export function categoryItems(report: SalesReport): BarListItem[] {
  return report.categories.map((category) => ({
    key: category.categoryId ?? 'not-recorded',
    name: category.name ?? NOT_RECORDED,
    value: category.salesRupees,
    figure: signedRupees(category.salesRupees),
    children: category.subcategories.map((subcategory) => ({
      key: subcategory.categoryId,
      name: subcategory.name,
      value: subcategory.salesRupees,
      figure: signedRupees(subcategory.salesRupees),
    })),
  }));
}

export function brandItems(report: SalesReport): BarListItem[] {
  return report.brands.map((brand) => {
    const unnamed = brand.recorded ? 'No brand' : NOT_RECORDED;
    return {
      key: brand.brandId ?? (brand.recorded ? 'no-brand' : 'not-recorded'),
      name: brand.name ?? unnamed,
      value: brand.salesRupees,
      figure: signedRupees(brand.salesRupees),
    };
  });
}

export function stateItems(report: SalesReport): BarListItem[] {
  return report.states.map((state) => ({
    key: state.state,
    name: state.state,
    value: state.salesRupees,
    figure: signedRupees(state.salesRupees),
    note: orders(state.orders),
  }));
}

export function methodItems(report: SalesReport): BarListItem[] {
  return report.methods.map((method) => ({
    key: method.method ?? 'not-recorded',
    name: method.method ? METHOD_NAMES[method.method] : NOT_RECORDED,
    value: method.salesRupees,
    figure: signedRupees(method.salesRupees),
    note: orders(method.orders),
  }));
}
