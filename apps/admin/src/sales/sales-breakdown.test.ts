import { describe, expect, it } from 'vitest';
import { reportOf } from '../test/sales-fixtures';
import {
  brandItems,
  categoryItems,
  methodItems,
  productItems,
  seriesColumns,
  signedCount,
  stateItems,
} from './sales-breakdown';

const point = (start: string, salesRupees: number, orders: number) => ({
  start,
  salesRupees,
  orders,
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
      },
      {
        key: 'name:Old Tulsi Tea',
        name: 'Old Tulsi Tea',
        value: 120,
        figure: '₹120',
        note: '1 pack',
      },
      {
        key: 'p3',
        name: 'Neem Soap',
        value: -90,
        figure: '−₹90',
        note: '−1 pack',
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
        children: [{ key: 'c2', name: 'Immunity', value: 600, figure: '₹600' }],
      },
      {
        key: 'not-recorded',
        name: 'Not recorded',
        value: 40,
        figure: '₹40',
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

    expect(items.map(({ key, name }) => ({ key, name }))).toEqual([
      { key: 'b1', name: 'Himalaya' },
      { key: 'no-brand', name: 'No brand' },
      { key: 'not-recorded', name: 'Not recorded' },
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
      },
    ]);
    expect(
      methodItems(report).map(({ key, name, figure, note }) => [
        key,
        name,
        figure,
        note,
      ]),
    ).toEqual([
      ['UPI', 'UPI', '₹1,170', '3 orders'],
      ['NETBANKING', 'Net banking', '₹200', '1 order'],
      ['PAY_LATER', 'Pay later', '₹100', '1 order'],
      ['not-recorded', 'Not recorded', '−₹428', '0 orders'],
    ]);
  });

  it('count below 0 with a true minus', () => {
    expect(signedCount(-2, 'pack', 'packs')).toBe('−2 packs');
    expect(signedCount(1500, 'pack', 'packs')).toBe('1,500 packs');
    expect(signedCount(0, 'pack', 'packs')).toBe('0 packs');
  });
});
