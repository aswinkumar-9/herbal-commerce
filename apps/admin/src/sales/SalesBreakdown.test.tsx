import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { reportOf } from '../test/sales-fixtures';
import type { SalesReport } from './sales-api';
import { SalesOverTime, SalesPlaces } from './SalesBreakdown';
import type { SalesFilter } from './sales-filters';

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

// Nothing in the period before.
const NONE = { salesRupees: 0, orders: 0 };

const point = (
  start: string,
  salesRupees: number,
  orders: number,
  previous = NONE,
) => ({ start, salesRupees, orders, previous });

function report(changes: Partial<SalesReport> = {}): SalesReport {
  return reportOf('2026-11-01', '2026-11-03', {
    series: {
      unit: 'day',
      points: [
        point('2026-11-01', 0, 0),
        point('2026-11-02', 449, 1, { salesRupees: 300, orders: 1 }),
        point('2026-11-03', 900, 2),
      ],
    },
    products: [
      {
        productId: 'p1',
        name: 'Ashwagandha Capsules',
        salesRupees: 855,
        packs: 2,
      },
      { productId: null, name: 'Gone Soap', salesRupees: 169, packs: 1 },
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
      { categoryId: null, name: null, salesRupees: 169, subcategories: [] },
    ],
    brands: [
      { brandId: 'b1', name: 'Himalaya', recorded: true, salesRupees: 855 },
      { brandId: null, name: null, recorded: true, salesRupees: 506 },
    ],
    states: STATES.map((state, i) => ({
      state,
      salesRupees: 1200 - i * 100,
      orders: 1,
    })),
    methods: [
      { method: 'UPI', salesRupees: 1170, orders: 3 },
      { method: null, salesRupees: 169, orders: 1 },
      { method: 'CARD', salesRupees: 450, orders: 1 },
    ],
    ...changes,
  });
}

function overTime(changes: Partial<SalesReport> = {}) {
  const onUnit = vi.fn();
  render(
    <SalesOverTime
      report={report(changes)}
      today="2026-11-25"
      onUnit={onUnit}
    />,
  );
  return { user: userEvent.setup(), onUnit };
}

function places(changes: Partial<SalesReport> = {}, filter: SalesFilter = {}) {
  const onPick = vi.fn();
  render(
    <SalesPlaces report={report(changes)} filter={filter} onPick={onPick} />,
  );
  return { user: userEvent.setup(), onPick };
}

// A list's own rows' names, not those of a list inside it.
const rows = (list: HTMLElement) =>
  [...list.children].map(
    (row) => row.firstElementChild?.firstElementChild?.textContent ?? '',
  );
const bars = () => screen.getByRole('group', { name: 'Bars' });
const shape = () => screen.getByRole('group', { name: 'Shape' });

describe('the sales over time', () => {
  it('is a line beside the same days of the period before, a range for the keyboard, and a table', async () => {
    const { user } = overTime();

    expect(
      screen.getByRole('heading', { name: 'Sales each day', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Without GST, less refunds. The grey line is the same days of the period before.',
      ),
    ).toBeInTheDocument();
    // The legend names both periods.
    expect(screen.getByText('1–3 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('29–31 Oct 2026')).toBeInTheDocument();
    expect(
      screen.getByRole('slider', { name: 'Sales each day' }),
    ).toHaveAttribute(
      'aria-valuetext',
      '3 Nov 2026: ₹900 from 2 orders. 31 Oct 2026: ₹0 from 0 orders',
    );

    await user.click(screen.getByRole('button', { name: 'Show as a table' }));
    const table = screen.getByRole('table', { name: 'Sales each day' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Day',
      'Sales',
      'Orders',
      'Period before',
      'Sales before',
      'Orders before',
    ]);
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent(
      '2 Nov 2026₹449130 Oct 2026₹3001',
    );
  });

  it('draws columns instead when asked, and the line again', async () => {
    const { user } = overTime();

    const line = within(shape()).getByRole('button', { name: 'Line' });
    const columns = within(shape()).getByRole('button', { name: 'Columns' });
    expect(line).toHaveAttribute('aria-pressed', 'true');
    await user.click(columns);
    expect(columns).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('slider', { name: 'Sales each day' }),
    ).toHaveAttribute('aria-valuetext', '3 Nov 2026: ₹900 from 2 orders');
    expect(screen.getByText('Without GST, less refunds.')).toBeInTheDocument();
    await user.click(line);
    expect(line).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers each size of bar, the one drawn pressed, those too many for one chart turned off', async () => {
    const { user, onUnit } = overTime();

    expect(
      within(bars())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Days', 'Weeks', 'Months', 'Quarters', 'Years']);
    expect(
      within(bars()).getByRole('button', { name: 'Days' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(bars()).getByRole('button', { name: 'Months' }));
    expect(onUnit).toHaveBeenCalledWith('month');
  });

  it('turns days off for a period of more than 366 of them', () => {
    render(
      <SalesOverTime
        report={reportOf('2025-01-01', '2026-01-02', {
          series: { unit: 'month', points: [point('2025-01-01', 0, 0)] },
        })}
        today="2026-11-25"
        onUnit={vi.fn()}
      />,
    );
    expect(within(bars()).getByRole('button', { name: 'Days' })).toBeDisabled();
    expect(within(bars()).getByRole('button', { name: 'Weeks' })).toBeEnabled();
  });

  it('says weeks start on Monday, and heads the table by weeks', async () => {
    const { user } = overTime({
      series: { unit: 'week', points: [point('2026-11-02', 900, 2)] },
    });
    expect(
      screen.getByRole('heading', { name: 'Sales each week', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Weeks start on Monday\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show as a table' }));
    expect(
      within(screen.getByRole('table', { name: 'Sales each week' }))
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)[0],
    ).toBe('Week');
  });

  it('names quarters by their months and financial years from April', () => {
    overTime({
      series: { unit: 'quarter', points: [point('2026-11-01', 900, 2)] },
    });
    expect(
      screen.getByRole('heading', { name: 'Sales each quarter', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Quarters start in January, April, July and October\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Oct–Dec 2026')).toBeInTheDocument();
  });

  it('says months without a word on weeks', () => {
    overTime({
      series: { unit: 'month', points: [point('2026-11-01', 900, 2)] },
    });
    expect(
      screen.getByRole('heading', { name: 'Sales each month', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Monday/)).not.toBeInTheDocument();
  });

  it('shows each day as a calendar for two weeks or more, not for less', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({
      day: `2026-11-${String(i + 1).padStart(2, '0')}`,
      salesRupees: i * 100,
      orders: i,
    }));
    const { unmount } = render(
      <SalesOverTime
        report={reportOf('2026-11-01', '2026-11-14', {
          series: { unit: 'day', points: [point('2026-11-01', 0, 0)] },
          calendar: days,
        })}
        today="2026-11-25"
        onUnit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Each day', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('slider', { name: 'Sales each day, as a calendar' }),
    ).toHaveAttribute(
      'aria-valuetext',
      'Saturday 14 Nov 2026: ₹1,300 from 13 orders',
    );
    unmount();

    overTime({ calendar: days.slice(0, 3) });
    expect(screen.queryByRole('heading', { name: 'Each day' })).toBeNull();
  });
});

describe('where the sales went', () => {
  it('ranks each grouping as bars, with its figures printed', () => {
    places();

    const products = screen.getByRole('list', { name: 'Top products' });
    expect(products).toHaveTextContent('Ashwagandha Capsules₹855 · 2 packs');
    const categories = screen.getByRole('list', { name: 'Categories' });
    expect(rows(categories)).toEqual(['Wellness', 'Not recorded']);
    expect(within(categories).getByText('Immunity')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Top brands', level: 2 }),
    ).toBeInTheDocument();
  });

  it('shows how customers paid as a ring, each way in its own place and colour, the unrecorded last', () => {
    places();

    const legend = screen.getByRole('list', { name: 'Payment methods' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'UPI₹1,170 · 3 orders65%',
      'Card₹450 · 1 order25%',
      'Not recorded₹169 · 1 order9%',
    ]);
    expect(screen.getByText('₹1,789')).toBeInTheDocument();
  });

  it('shows how customers paid as bars when a way gave back more than it took', () => {
    places({
      methods: [
        { method: 'UPI', salesRupees: 1170, orders: 3 },
        { method: 'CARD', salesRupees: -428, orders: 0 },
      ],
    });
    const list = screen.getByRole('list', { name: 'Payment methods' });
    expect(rows(list)).toEqual(['UPI', 'Card']);
    expect(list).toHaveTextContent('−₹428');
  });

  it('narrows the page to a name chosen, saying which is chosen, but not to what was not recorded', async () => {
    const { user, onPick } = places({}, { state: 'Kerala', method: 'UPI' });

    const states = screen.getByRole('list', { name: 'States' });
    const kerala = within(states).getByRole('button', { name: 'Kerala' });
    expect(kerala).toHaveAttribute('aria-pressed', 'true');
    expect(within(states).getByRole('button', { name: 'Goa' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(within(states).getByRole('button', { name: 'Goa' }));
    expect(onPick).toHaveBeenLastCalledWith('state', 'Goa', 'Goa');

    // A subcategory with its top category.
    const categories = screen.getByRole('list', { name: 'Categories' });
    await user.click(
      within(categories).getByRole('button', { name: 'Immunity' }),
    );
    expect(onPick).toHaveBeenLastCalledWith(
      'category',
      'c2',
      'Wellness › Immunity',
    );
    expect(
      within(categories).queryByRole('button', { name: 'Not recorded' }),
    ).toBeNull();

    const methods = screen.getByRole('list', { name: 'Payment methods' });
    expect(
      within(methods).getByRole('button', { name: 'UPI' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(
      within(methods).getByRole('button', { name: 'Not recorded' }),
    );
    expect(onPick).toHaveBeenLastCalledWith(
      'method',
      'NOT_RECORDED',
      'Not recorded',
    );

    const brands = screen.getByRole('list', { name: 'Top brands' });
    await user.click(within(brands).getByRole('button', { name: 'Himalaya' }));
    expect(onPick).toHaveBeenLastCalledWith('brand', 'b1', 'Himalaya');
    expect(
      within(brands).queryByRole('button', { name: 'No brand' }),
    ).toBeNull();

    const products = screen.getByRole('list', { name: 'Top products' });
    await user.click(
      within(products).getByRole('button', { name: 'Ashwagandha Capsules' }),
    );
    expect(onPick).toHaveBeenLastCalledWith(
      'product',
      'p1',
      'Ashwagandha Capsules',
    );
    expect(
      within(products).queryByRole('button', { name: 'Gone Soap' }),
    ).toBeNull();
  });

  it('shows a list of 10 whole, with no button', () => {
    places({
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
    places({ brands: [], methods: [] });
    const brands = screen.getByRole('heading', { name: 'Top brands' })
      .parentElement as HTMLElement;
    expect(brands).toHaveTextContent('Nothing in this period.');
    expect(within(brands).queryByRole('list')).not.toBeInTheDocument();
    const methods = screen.getByRole('heading', { name: 'Payment methods' })
      .parentElement as HTMLElement;
    expect(methods).toHaveTextContent('Nothing in this period.');
  });

  it('shows the best 10 of a longer list, and all of it when asked', async () => {
    const { user } = places();

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
