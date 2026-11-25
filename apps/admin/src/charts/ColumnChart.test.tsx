import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { type ChartColumn, ColumnChart } from './ColumnChart';

const HINT = 'Point at a column, or use the arrow keys, to see its numbers.';

function day(n: number, value: number): ChartColumn {
  return {
    key: `2026-11-${String(n).padStart(2, '0')}`,
    label: `${n} Nov`,
    value,
    readout: `${n} November: ₹${value} from 1 order`,
    cells: [`${n} November`, `₹${value}`, '1'],
  };
}

const WEEK = [day(1, 120), day(2, 0), day(3, 900), day(4, -428), day(5, 449)];

function draw(columns = WEEK) {
  const view = render(
    <ColumnChart
      label="Sales each day"
      columns={columns}
      tableHeaders={['Day', 'Sales', 'Orders']}
    />,
  );
  // The drawing itself, and the line above it, are hidden from screen
  // readers: the range over the columns and the table carry its numbers.
  const svg = view.container.querySelector('svg[aria-hidden="true"]');
  if (!svg) {
    throw new Error('no chart drawn');
  }
  const columnsDrawn = () => [...svg.querySelectorAll('path')];
  const texts = () =>
    [...svg.querySelectorAll('text')].map((t) => t.textContent);
  const readout = view.container.querySelector('p[aria-hidden="true"]');
  return { svg, columnsDrawn, texts, readout };
}

const range = () => screen.getByRole('slider', { name: 'Sales each day' });

describe('ColumnChart', () => {
  it('draws a thin column for each value but 0, from a clean axis that goes below 0 when a value does', () => {
    const { columnsDrawn, texts, svg, readout } = draw();

    expect(columnsDrawn()).toHaveLength(4);
    for (const column of columnsDrawn()) {
      expect(column).toHaveClass('fill-series');
    }
    expect(texts()).toEqual(
      expect.arrayContaining(['−₹500', '₹0', '₹500', '₹1,000']),
    );
    // The zero line is the strong one; the other gridlines are soft.
    const lines = [...svg.querySelectorAll('line')];
    expect(
      lines.filter((line) => line.classList.contains('stroke-line-strong')),
    ).toHaveLength(1);
    expect(
      lines.filter((line) => line.classList.contains('stroke-line')).length,
    ).toBeGreaterThan(1);
    // A column above 0 rises from the baseline, one below it falls: ₹900
    // and −₹428, the second and third drawn (the day of 0 draws none).
    const [, rises, falls] = columnsDrawn().map((column) => {
      const [, from, to] =
        /^M[\d.]+ ([\d.]+) V([\d.]+)/.exec(column.getAttribute('d') ?? '') ??
        [];
      return Number(to) - Number(from);
    });
    expect(rises).toBeLessThan(0);
    expect(falls).toBeGreaterThan(0);
    // No column is wider than 24 pixels.
    for (const column of columnsDrawn()) {
      const xs = [
        ...(column.getAttribute('d') ?? '').matchAll(/[MQH](-?[\d.]+)/g),
      ].map((m) => Number(m[1]));
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(24);
    }
    expect(readout).toHaveTextContent(HINT);
  });

  it('labels the columns underneath without crowding them, the first and the last always', () => {
    const month = Array.from({ length: 30 }, (_, i) => day(i + 1, 100 + i));
    const { texts } = draw(month);

    const labels = texts().filter((text) => text?.endsWith('Nov'));
    expect(labels[0]).toBe('1 Nov');
    expect(labels.at(-1)).toBe('30 Nov');
    expect(labels.length).toBeLessThan(30);
  });

  it('says a column’s numbers under the pointer, lightening it, and stops when the pointer leaves', () => {
    const { svg, columnsDrawn, readout } = draw();

    fireEvent.pointerMove(svg, { clientX: 100_000 });
    expect(readout).toHaveTextContent('5 November: ₹449 from 1 order');
    expect(columnsDrawn().at(-1)).toHaveClass('fill-series-hover');
    expect(
      columnsDrawn().filter((c) => c.classList.contains('fill-series-hover')),
    ).toHaveLength(1);

    fireEvent.pointerMove(svg, { clientX: -100 });
    expect(readout).toHaveTextContent('1 November: ₹120 from 1 order');

    fireEvent.pointerLeave(svg);
    expect(readout).toHaveTextContent(HINT);
    expect(
      columnsDrawn().filter((c) => c.classList.contains('fill-series-hover')),
    ).toHaveLength(0);
  });

  it('gives the keyboard a range over the columns, from the latest, each column’s numbers its value', async () => {
    const user = userEvent.setup();
    const { readout, columnsDrawn } = draw();

    await user.tab();
    expect(range()).toHaveFocus();
    expect(range()).toHaveAttribute('min', '0');
    expect(range()).toHaveAttribute('max', '4');
    expect(range()).toHaveValue('4');
    expect(range()).toHaveAttribute(
      'aria-valuetext',
      '5 November: ₹449 from 1 order',
    );
    expect(readout).toHaveTextContent('5 November');
    expect(columnsDrawn().at(-1)).toHaveClass('fill-series-hover');

    // The arrow keys, Home and End are the browser's own on a range.
    fireEvent.change(range(), { target: { value: '3' } });
    expect(range()).toHaveAttribute(
      'aria-valuetext',
      '4 November: ₹-428 from 1 order',
    );
    expect(readout).toHaveTextContent('4 November: ₹-428');

    await user.tab();
    expect(readout).toHaveTextContent(HINT);
  });

  it('has no range when there are no columns', () => {
    render(
      <ColumnChart
        label="Sales each day"
        columns={[]}
        tableHeaders={['Day']}
      />,
    );
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('shows every value as a table, a button away', async () => {
    const user = userEvent.setup();
    draw();

    const button = screen.getByRole('button', { name: 'Show as a table' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('Hide the table');
    const table = screen.getByRole('table', { name: 'Sales each day' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Day', 'Sales', 'Orders']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5);
    expect(
      within(rows[3] as HTMLElement).getByRole('rowheader'),
    ).toHaveTextContent('4 November');
    expect(rows[3]).toHaveTextContent('₹-428');

    await user.click(button);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('draws nothing but its axis when every value is 0, or there are none', () => {
    const { columnsDrawn, texts } = draw([day(1, 0), day(2, 0)]);
    expect(columnsDrawn()).toHaveLength(0);
    expect(texts()).toContain('₹0');
  });
});
