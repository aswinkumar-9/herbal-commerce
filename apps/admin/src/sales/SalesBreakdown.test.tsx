import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { reportOf } from '../test/sales-fixtures';
import type { SalesReport } from './sales-api';
import { SalesBreakdown } from './SalesBreakdown';

const STATES = [
  'Karnataka',
  'Kerala',
  'Tamil Nadu',
  'Telangana',
  'Maharashtra',
  'Goa',
  'Gujarat',
  'Punjab',
  'Delhi',
  'Odisha',
  'Assam',
  'Bihar',
];

function draw(changes: Partial<SalesReport> = {}) {
  render(
    <SalesBreakdown
      report={reportOf('2026-11-01', '2026-11-03', {
        series: {
          unit: 'day',
          points: [
            { start: '2026-11-01', salesRupees: 0, orders: 0 },
            { start: '2026-11-02', salesRupees: 449, orders: 1 },
            { start: '2026-11-03', salesRupees: 900, orders: 2 },
          ],
        },
        products: [
          {
            productId: 'p1',
            name: 'Ashwagandha Capsules',
            salesRupees: 855,
            packs: 2,
          },
        ],
        categories: [
          {
            categoryId: 'c1',
            name: 'Wellness',
            salesRupees: 855,
            subcategories: [
              { categoryId: 'c2', name: 'Immunity', salesRupees: 600 },
            ],
          },
        ],
        states: STATES.map((state, i) => ({
          state,
          salesRupees: 1200 - i * 100,
          orders: 1,
        })),
        methods: [{ method: 'UPI', salesRupees: 1349, orders: 3 }],
        ...changes,
      })}
    />,
  );
  return { user: userEvent.setup() };
}

// A list's own rows, not those of a list inside it.
const rows = (list: HTMLElement) =>
  [...list.children].map((row) => row.querySelector('span')?.textContent ?? '');

describe('the sales over time', () => {
  it('is a column for each day, a range for the keyboard, and a table', async () => {
    const { user } = draw();

    expect(
      screen.getByRole('heading', { name: 'Sales each day', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Without GST, less refunds.')).toBeInTheDocument();
    expect(
      screen.getByRole('slider', { name: 'Sales each day' }),
    ).toHaveAttribute('aria-valuetext', '3 Nov 2026: ₹900 from 2 orders');

    await user.click(screen.getByRole('button', { name: 'Show as a table' }));
    const table = screen.getByRole('table', { name: 'Sales each day' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Day', 'Sales', 'Orders']);
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('says weeks start on Monday, and heads the table by weeks', async () => {
    const { user } = draw({
      series: {
        unit: 'week',
        points: [{ start: '2026-11-02', salesRupees: 900, orders: 2 }],
      },
    });
    expect(
      screen.getByRole('heading', { name: 'Sales each week', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Without GST, less refunds. Weeks start on Monday.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show as a table' }));
    expect(
      within(screen.getByRole('table', { name: 'Sales each week' }))
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Week', 'Sales', 'Orders']);
  });

  it('says months without a word on weeks', () => {
    draw({
      series: {
        unit: 'month',
        points: [{ start: '2026-11-01', salesRupees: 900, orders: 2 }],
      },
    });
    expect(
      screen.getByRole('heading', { name: 'Sales each month', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Monday/)).not.toBeInTheDocument();
  });
});

describe('the lists', () => {
  it('rank each grouping as bars, with its figures printed', () => {
    draw();

    const products = screen.getByRole('list', { name: 'Top products' });
    expect(products).toHaveTextContent('Ashwagandha Capsules₹855 · 2 packs');
    const categories = screen.getByRole('list', { name: 'Categories' });
    expect(rows(categories)).toEqual(['Wellness']);
    expect(within(categories).getAllByRole('list')).toHaveLength(1);
    expect(within(categories).getByText('Immunity')).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Payment methods' }),
    ).toHaveTextContent('UPI₹1,349 · 3 orders');
    expect(
      screen.getByRole('heading', { name: 'Top brands', level: 2 }),
    ).toBeInTheDocument();
  });

  it('shows a list of 10 whole, with no button', () => {
    draw({
      products: Array.from({ length: 10 }, (_, i) => ({
        productId: `p${i}`,
        name: `Product ${i}`,
        salesRupees: 1000 - i,
        packs: 1,
      })),
    });
    expect(
      screen.getByRole('list', { name: 'Top products' }).children,
    ).toHaveLength(10);
    expect(screen.getAllByRole('button', { name: /^Show all/ })).toHaveLength(
      1,
    );
  });

  it('says when a list has nothing', () => {
    draw();
    const brands = screen.getByRole('heading', { name: 'Top brands' })
      .parentElement as HTMLElement;
    expect(brands).toHaveTextContent('Nothing in this period.');
    expect(within(brands).queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows the best 10 of a longer list, and all of it when asked', async () => {
    const { user } = draw();

    const states = screen.getByRole('list', { name: 'States' });
    expect(rows(states)).toEqual(STATES.slice(0, 10));
    const more = screen.getByRole('button', { name: 'Show all 12' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute(
      'aria-controls',
      states.parentElement?.id ?? 'none',
    );

    await user.click(more);
    expect(rows(screen.getByRole('list', { name: 'States' }))).toEqual(STATES);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveTextContent('Show the best 10');

    await user.click(more);
    expect(rows(screen.getByRole('list', { name: 'States' }))).toHaveLength(10);
    // The shorter lists need no button.
    expect(screen.getAllByRole('button', { name: /^Show all/ })).toHaveLength(
      1,
    );
  });
});
