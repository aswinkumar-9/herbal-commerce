import { describe, expect, it } from 'vitest';
import { reportOf } from '../test/sales-fixtures';
import {
  brandItems,
  calendarDays,
  categoryItems,
  columnLabel,
  linePoints,
  methodItems,
  methodParts,
  productItems,
  ringFits,
  seriesColumns,
  signedCount,
  stateItems,
} from './sales-breakdown';

const point = (
  start: string,
  salesRupees: number,
  orders: number,
  previous = { salesRupees: 0, orders: 0 },
) => ({
  start,
  salesRupees,
  orders,
  previous,
});

describe('the columns over time', () => {
  it('are each day, labelled short, read out and tabled in full', () => {
    const columns = seriesColumns(
      reportOf('2026-11-01', '2026-11-03', {
        series: {
          unit: 'day',
          points: [
            point('2026-11-01', 0, 0),
            point('2026-11-02', 449, 1),
            point('2026-11-03', -428, 0),
          ],
        },
      }),
    );

    expect(columns.map((column) => column.label)).toEqual([
      '1 Nov',
      '2 Nov',
      '3 Nov',
    ]);
    expect(columns.map((column) => column.value)).toEqual([0, 449, -428]);
    expect(columns.map((column) => column.readout)).toEqual([
      '1 Nov 2026: ₹0 from 0 orders',
      '2 Nov 2026: ₹449 from 1 order',
      '3 Nov 2026: −₹428 from 0 orders',
    ]);
    expect(columns[1]).toMatchObject({
      key: '2026-11-02',
      cells: ['2 Nov 2026', '₹449', '1'],
    });
  });

  it('say the days a week covers, the first and last cut to the period', () => {
    const columns = seriesColumns(
      reportOf('2026-11-04', '2026-12-01', {
        series: {
          unit: 'week',
          points: [
            point('2026-11-04', 900, 2),
            point('2026-11-09', 0, 0),
            point('2026-11-16', 0, 0),
            point('2026-11-23', 0, 0),
            point('2026-11-30', 1500, 3),
          ],
        },
      }),
    );

    expect(columns[0]?.label).toBe('4 Nov');
    expect(columns[0]?.readout).toBe('4–8 Nov 2026: ₹900 from 2 orders');
    expect(columns[1]?.readout).toBe('9–15 Nov 2026: ₹0 from 0 orders');
    expect(columns[4]?.label).toBe('30 Nov');
    expect(columns[4]?.readout).toBe(
      '30 Nov – 1 Dec 2026: ₹1,500 from 3 orders',
    );
  });

  it('name a month with its year', () => {
    const columns = seriesColumns(
      reportOf('2025-12-15', '2026-02-10', {
        series: {
          unit: 'month',
          points: [
            point('2025-12-15', 100, 1),
            point('2026-01-01', 200, 2),
            point('2026-02-01', 300, 3),
          ],
        },
      }),
    );

    expect(columns.map((column) => column.label)).toEqual([
      'Dec 2025',
      'Jan 2026',
      'Feb 2026',
    ]);
    expect(columns.map((column) => column.cells[0])).toEqual([
      '15–31 Dec 2025',
      '1–31 Jan 2026',
      '1–10 Feb 2026',
    ]);
  });
});

describe('the lists', () => {
  it('name products as they last sold, with their packs', () => {
    const items = productItems(
      reportOf('2026-11-01', '2026-11-25', {
        products: [
          {
            productId: 'p1',
            name: 'Ashwagandha Capsules',
            salesRupees: 855,
            packs: 2,
          },
          {
            productId: null,
            name: 'Old Tulsi Tea',
            salesRupees: 120,
            packs: 1,
          },
          { productId: 'p3', name: 'Neem Soap', salesRupees: -90, packs: -1 },
        ],
      }),
    );

    expect(items).toEqual([
      {
        key: 'p1',
        name: 'Ashwagandha Capsules',
        value: 855,
        figure: '₹855',
        note: '2 packs',
        pickable: true,
      },
      {
        key: 'name:Old Tulsi Tea',
        name: 'Old Tulsi Tea',
        value: 120,
        figure: '₹120',
        note: '1 pack',
        // Known by its name only: nothing to narrow to.
        pickable: false,
      },
      {
        key: 'p3',
        name: 'Neem Soap',
        value: -90,
        figure: '−₹90',
        note: '−1 pack',
        pickable: true,
      },
    ]);
  });

  it('put subcategories under their category, and old lines under Not recorded', () => {
    const items = categoryItems(
      reportOf('2026-11-01', '2026-11-25', {
        categories: [
          {
            categoryId: 'c1',
            name: 'Wellness',
            salesRupees: 855,
            subcategories: [
              { categoryId: 'c2', name: 'Immunity', salesRupees: 600 },
            ],
          },
          {
            categoryId: null,
            name: null,
            salesRupees: 40,
            subcategories: [],
          },
        ],
      }),
    );

    expect(items).toEqual([
      {
        key: 'c1',
        name: 'Wellness',
        value: 855,
        figure: '₹855',
        pickable: true,
        children: [
          {
            key: 'c2',
            name: 'Immunity',
            value: 600,
            figure: '₹600',
            pickable: true,
          },
        ],
      },
      {
        key: 'not-recorded',
        name: 'Not recorded',
        value: 40,
        figure: '₹40',
        pickable: false,
        children: [],
      },
    ]);
  });

  it('tell a product without a brand from an old line', () => {
    const items = brandItems(
      reportOf('2026-11-01', '2026-11-25', {
        brands: [
          { brandId: 'b1', name: 'Himalaya', recorded: true, salesRupees: 855 },
          { brandId: null, name: null, recorded: true, salesRupees: 506 },
          { brandId: null, name: null, recorded: false, salesRupees: 40 },
        ],
      }),
    );

    expect(
      items.map(({ key, name, pickable }) => ({ key, name, pickable })),
    ).toEqual([
      { key: 'b1', name: 'Himalaya', pickable: true },
      // Neither is a brand to narrow to.
      { key: 'no-brand', name: 'No brand', pickable: false },
      { key: 'not-recorded', name: 'Not recorded', pickable: false },
    ]);
  });

  it('give states and payment methods their orders', () => {
    const report = reportOf('2026-11-01', '2026-11-25', {
      states: [{ state: 'Karnataka', salesRupees: 1350, orders: 3 }],
      methods: [
        { method: 'UPI', salesRupees: 1170, orders: 3 },
        { method: 'NETBANKING', salesRupees: 200, orders: 1 },
        { method: 'PAY_LATER', salesRupees: 100, orders: 1 },
        { method: null, salesRupees: -428, orders: 0 },
      ],
    });

    expect(stateItems(report)).toEqual([
      {
        key: 'Karnataka',
        name: 'Karnataka',
        value: 1350,
        figure: '₹1,350',
        note: '3 orders',
        pickable: true,
      },
    ]);
    expect(
      methodItems(report).map(({ key, name, figure, note, pickable }) => [
        key,
        name,
        figure,
        note,
        pickable,
      ]),
    ).toEqual([
      ['UPI', 'UPI', '₹1,170', '3 orders', true],
      ['NETBANKING', 'Net banking', '₹200', '1 order', true],
      ['PAY_LATER', 'Pay later', '₹100', '1 order', true],
      // The payments that kept none can be narrowed to.
      ['not-recorded', 'Not recorded', '−₹428', '0 orders', true],
    ]);
  });

  it('count below 0 with a true minus', () => {
    expect(signedCount(-2, 'pack', 'packs')).toBe('−2 packs');
    expect(signedCount(1500, 'pack', 'packs')).toBe('1,500 packs');
    expect(signedCount(0, 'pack', 'packs')).toBe('0 packs');
  });
});

describe('the bars of part 15E', () => {
  it('name quarters by their months and financial years from April', () => {
    expect(columnLabel('quarter', '2026-10-01')).toBe('Oct–Dec 2026');
    // A first quarter cut to the period still names the whole quarter.
    expect(columnLabel('quarter', '2026-02-15')).toBe('Jan–Mar 2026');
    expect(columnLabel('year', '2026-04-01')).toBe('FY 2026–27');
    expect(columnLabel('year', '2026-01-01')).toBe('FY 2025–26');
    expect(columnLabel('year', '2099-04-01')).toBe('FY 2099–00');
  });

  it('put each bar beside the same days of the period before', () => {
    const points = linePoints(
      reportOf('2026-11-01', '2026-11-14', {
        series: {
          unit: 'week',
          points: [
            point('2026-11-01', 449, 1, { salesRupees: 300, orders: 1 }),
            point('2026-11-02', 900, 2),
            point('2026-11-09', -428, 0, { salesRupees: 120, orders: 2 }),
          ],
        },
      }),
    );
    expect(points.map((p) => [p.label, p.value, p.previous])).toEqual([
      ['1 Nov', 449, 300],
      ['2 Nov', 900, 0],
      ['9 Nov', -428, 120],
    ]);
    // Fourteen days earlier.
    expect(points[0]?.readout).toBe(
      '1 Nov 2026: ₹449 from 1 order. 18 Oct 2026: ₹300 from 1 order',
    );
    expect(points[2]?.readout).toBe(
      '9–14 Nov 2026: −₹428 from 0 orders. 26–31 Oct 2026: ₹120 from 2 orders',
    );
    expect(points[2]?.cells).toEqual([
      '9–14 Nov 2026',
      '−₹428',
      '0',
      '26–31 Oct 2026',
      '₹120',
      '2',
    ]);
  });

  it('give each day of the calendar its weekday, and none for a period too long', () => {
    const days = calendarDays(
      reportOf('2026-11-01', '2026-11-02', {
        calendar: [
          { day: '2026-11-01', salesRupees: 0, orders: 0 },
          { day: '2026-11-02', salesRupees: 1250, orders: 3 },
        ],
      }),
    );
    expect(days?.map((day) => day.readout)).toEqual([
      'Sunday 1 Nov 2026: ₹0 from 0 orders',
      'Monday 2 Nov 2026: ₹1,250 from 3 orders',
    ]);
    expect(days?.[1]?.cells).toEqual(['2 Nov 2026', 'Monday', '₹1,250', '3']);
    expect(calendarDays(reportOf('2020-01-01', '2026-11-25'))).toBeNull();
  });

  it('keep each way of paying in its own place and colour round the ring, the unrecorded last in grey', () => {
    const parts = methodParts(
      reportOf('2026-11-01', '2026-11-25', {
        methods: [
          { method: null, salesRupees: 169, orders: 1 },
          { method: 'PAY_LATER', salesRupees: 100, orders: 1 },
          { method: 'UPI', salesRupees: 1170, orders: 3 },
          { method: 'OTHER', salesRupees: 50, orders: 1 },
        ],
      }),
    );
    expect(parts.map(({ key, name, colour }) => [key, name, colour])).toEqual([
      ['UPI', 'UPI', 1],
      ['PAY_LATER', 'Pay later', 6],
      ['OTHER', 'Other', 7],
      ['not-recorded', 'Not recorded', 'other'],
    ]);
    expect(parts[0]?.figure).toBe('₹1,170 · 3 orders');
    expect(parts.every((part) => part.pickable)).toBe(true);
  });

  it('draw a ring only for two to six parts, none below 0', () => {
    const part = (value: number) => ({
      key: String(value),
      name: String(value),
      value,
      colour: 1 as const,
      figure: '',
    });
    expect(ringFits([part(10), part(5)])).toBe(true);
    expect(ringFits([part(10), part(0)])).toBe(false);
    expect(ringFits([part(10), part(5), part(-1)])).toBe(false);
    expect(ringFits([1, 2, 3, 4, 5, 6].map(part))).toBe(true);
    expect(ringFits([1, 2, 3, 4, 5, 6, 7].map(part))).toBe(false);
    // Nothing at all is a part of 0 too.
    expect(ringFits([part(0), part(0), part(4), part(3)])).toBe(true);
  });
});
