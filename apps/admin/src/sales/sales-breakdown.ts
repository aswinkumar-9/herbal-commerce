import type { BarListItem } from '../charts/BarList';
import type { CalendarDay } from '../charts/CalendarChart';
import type { ChartColumn } from '../charts/ColumnChart';
import type { DonutPart, PartColour } from '../charts/DonutChart';
import type { LinePoint } from '../charts/LineChart';
import { signedRupees } from '../charts/chart-scale';
import { dayName } from '../stock/stock-display';
import { PAYMENT_METHODS } from './sales-api';
import type { PaymentMethod, SalesReport } from './sales-api';
import { periodName } from './sales-display';
import { addDays, daysIn, financialYearOf } from './sales-periods';
import type { Unit } from './sales-periods';

// The report's series and lists, as the Sales page's charts and bars draw
// them (part 15D, ADR 0047; quarters, financial years, the period before
// and the calendar since part 15E).

export const UNIT_NAMES: Record<
  Unit,
  { title: string; header: string; button: string }
> = {
  day: { title: 'Sales each day', header: 'Day', button: 'Days' },
  week: { title: 'Sales each week', header: 'Week', button: 'Weeks' },
  month: { title: 'Sales each month', header: 'Month', button: 'Months' },
  quarter: {
    title: 'Sales each quarter',
    header: 'Quarter',
    button: 'Quarters',
  },
  year: {
    title: 'Sales each financial year',
    header: 'Financial year',
    button: 'Years',
  },
};

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

// "3 Nov" under a day or a week (its first day), "Nov 2026" under a month,
// "Apr–Jun 2026" under a quarter and "FY 2026–27" under a financial year:
// the whole quarter or year it falls in, though the first may start later.
export function columnLabel(unit: Unit, start: string): string {
  const name = dayName(start);
  if (unit === 'month') {
    return name.replace(/^\d+ /, '');
  }
  if (unit === 'quarter') {
    const first = Math.floor((Number(start.slice(5, 7)) - 1) / 3) * 3;
    return `${MONTHS[first]}–${MONTHS[first + 2]} ${start.slice(0, 4)}`;
  }
  if (unit === 'year') {
    const year = Number(financialYearOf(start).slice(0, 4));
    return `FY ${year}–${String(year + 1).slice(2)}`;
  }
  return name.replace(/ \d{4}$/, '');
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
    const days = periodName(barDays(report, i));
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

// The days a bar covers: to the day before the next bar, the last to the
// period's end.
function barDays(report: SalesReport, i: number) {
  const point = report.series.points[i];
  const next = report.series.points[i + 1];
  return {
    from: point?.start ?? report.period.from,
    to: next ? addDays(next.start, -1) : report.period.to,
  };
}

// A point for each bar, beside the same days of the period before: as
// many days earlier as the period is long.
export function linePoints(report: SalesReport): LinePoint[] {
  const { unit, points } = report.series;
  const length = daysIn(report.period);
  return points.map((point, i) => {
    const days = barDays(report, i);
    const now = periodName(days);
    const before = periodName({
      from: addDays(days.from, -length),
      to: addDays(days.to, -length),
    });
    const sales = signedRupees(point.salesRupees);
    const earlier = signedRupees(point.previous.salesRupees);
    return {
      key: point.start,
      label: columnLabel(unit, point.start),
      value: point.salesRupees,
      previous: point.previous.salesRupees,
      readout: `${now}: ${sales} from ${orders(point.orders)}. ${before}: ${earlier} from ${orders(point.previous.orders)}`,
      cells: [
        now,
        sales,
        point.orders.toLocaleString('en-IN'),
        before,
        earlier,
        point.previous.orders.toLocaleString('en-IN'),
      ],
    };
  });
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const weekdayName = (day: string) =>
  WEEKDAYS[new Date(`${day}T00:00:00.000Z`).getUTCDay()] ?? '';

// Each day of the period for the calendar, none for a period too long.
export function calendarDays(report: SalesReport): CalendarDay[] | null {
  return (
    report.calendar?.map((day) => {
      const sales = signedRupees(day.salesRupees);
      return {
        day: day.day,
        value: day.salesRupees,
        readout: `${weekdayName(day.day)} ${dayName(day.day)}: ${sales} from ${orders(day.orders)}`,
        cells: [
          dayName(day.day),
          weekdayName(day.day),
          sales,
          day.orders.toLocaleString('en-IN'),
        ],
      };
    }) ?? null
  );
}

// Each way of paying its own colour of the design system, in this order
// round the ring, and grey for the payments that kept none.
const METHOD_COLOURS: Record<PaymentMethod, PartColour> = {
  UPI: 1,
  CARD: 2,
  NETBANKING: 3,
  WALLET: 4,
  EMI: 5,
  PAY_LATER: 6,
  OTHER: 7,
};

// The ways customers paid as parts of the whole, in the same order every
// time, so each keeps its place and colour.
export function methodParts(report: SalesReport): DonutPart[] {
  const byMethod = new Map(
    report.methods.map((method) => [method.method, method]),
  );
  return [...PAYMENT_METHODS, null].flatMap((key) => {
    const method = byMethod.get(key);
    if (!method) {
      return [];
    }
    return [
      {
        key: key ?? 'not-recorded',
        name: key ? METHOD_NAMES[key] : NOT_RECORDED,
        value: method.salesRupees,
        colour: key ? METHOD_COLOURS[key] : 'other',
        figure: `${signedRupees(method.salesRupees)} · ${orders(method.orders)}`,
        pickable: true,
      },
    ];
  });
}

// A ring only for two to six parts, none below 0 (the data-viz method):
// otherwise bars, which show any number and less than nothing.
export function ringFits(parts: readonly DonutPart[]): boolean {
  const drawn = parts.filter((part) => part.value > 0).length;
  return parts.every((part) => part.value >= 0) && drawn >= 2 && drawn <= 6;
}

export function productItems(report: SalesReport): BarListItem[] {
  return report.products.map((product) => ({
    key: product.productId ?? `name:${product.name}`,
    name: product.name,
    value: product.salesRupees,
    figure: signedRupees(product.salesRupees),
    note: signedCount(product.packs, 'pack', 'packs'),
    // One known by its name only can't be chosen.
    pickable: product.productId !== null,
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
    pickable: category.categoryId !== null,
    children: category.subcategories.map((subcategory) => ({
      key: subcategory.categoryId,
      name: subcategory.name,
      value: subcategory.salesRupees,
      figure: signedRupees(subcategory.salesRupees),
      pickable: true,
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
      // No brand, and not recorded, are not brands to choose.
      pickable: brand.brandId !== null,
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
    pickable: true,
  }));
}

export function methodItems(report: SalesReport): BarListItem[] {
  return report.methods.map((method) => ({
    key: method.method ?? 'not-recorded',
    name: method.method ? METHOD_NAMES[method.method] : NOT_RECORDED,
    value: method.salesRupees,
    figure: signedRupees(method.salesRupees),
    note: orders(method.orders),
    // The payments that kept no method can be chosen too.
    pickable: true,
  }));
}
