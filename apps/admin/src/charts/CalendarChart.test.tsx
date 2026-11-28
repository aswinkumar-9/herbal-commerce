import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { signedRupees } from './chart-scale';
import { type CalendarDay, CalendarChart } from './CalendarChart';

const HINT = 'Point at a day, or use the arrow keys, to see its numbers.';

// Every day of November 2026 (the 1st a Sunday), with these sales.
function november(sales: Record<number, number>): CalendarDay[] {
  return Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    const value = sales[n] ?? 0;
    return {
      day: `2026-11-${String(n).padStart(2, '0')}`,
      value,
      readout: `${n} November: ₹${value}`,
      cells: [`${n} November`, `₹${value}`],
    };
  });
}

const SALES = { 2: 1000, 3: 250, 4: 251, 5: 760, 6: -428 };

function draw(days = november(SALES), today = '2026-11-27') {
  const view = render(
    <CalendarChart
      label="Sales each day, as a calendar"
      days={days}
      today={today}
      tableHeaders={['Day', 'Sales']}
      format={signedRupees}
    />,
  );
  const svg = view.container.querySelector('svg[aria-hidden="true"]');
  if (!svg) {
    throw new Error('no chart drawn');
  }
  const square = (day: number) =>
    svg.querySelector(
      `rect[data-day="2026-11-${String(day).padStart(2, '0')}"]`,
    ) as SVGRectElement;
  const texts = () =>
    [...svg.querySelectorAll('text')].map((t) => t.textContent);
  const readout = view.container.querySelector('p[aria-hidden="true"]');
  return { svg, square, texts, readout };
}

const range = () =>
  screen.getByRole('slider', { name: 'Sales each day, as a calendar' });

describe('CalendarChart', () => {
  it('puts each day in its week’s column from Monday, the 1st a Sunday at the foot of the first', () => {
    const { square, svg, texts } = draw();

    expect(svg.querySelectorAll('rect[data-day]')).toHaveLength(30);
    const x = (day: number) => Number(square(day).getAttribute('x'));
    const y = (day: number) => Number(square(day).getAttribute('y'));
    // Sunday the 1st, then Monday the 2nd at the top of the next week.
    expect(x(2)).toBeGreaterThan(x(1));
    expect(y(2)).toBeLessThan(y(1));
    expect(x(8)).toBe(x(2));
    expect(x(9)).toBeGreaterThan(x(8));
    expect(y(9)).toBe(y(2));
    // Weekdays and the month named.
    expect(texts()).toEqual(['Nov', 'Mon', 'Wed', 'Fri']);
  });

  it('shades each day by a quarter step of the most sold, nothing sold or less in the muted surface', () => {
    const { square } = draw();

    // The most, ₹1,000: steps up to ₹250, ₹500, ₹750 and ₹1,000.
    expect(square(2)).toHaveAttribute('data-step', '4');
    expect(square(2)).toHaveClass('fill-heat-4');
    expect(square(3)).toHaveAttribute('data-step', '1');
    expect(square(3)).toHaveClass('fill-heat-1');
    expect(square(4)).toHaveClass('fill-heat-2');
    expect(square(5)).toHaveClass('fill-heat-4');
    expect(square(1)).toHaveClass('fill-surface-muted');
    // More refunded than sold: nothing sold, its number in the readout.
    expect(square(6)).toHaveClass('fill-surface-muted');
  });

  it('only outlines the days still to come, and says so in the legend', () => {
    const { square } = draw(november(SALES), '2026-11-27');

    expect(square(27)).toHaveAttribute('data-step', '0');
    expect(square(28)).toHaveAttribute('data-step', 'to-come');
    expect(square(28)).toHaveClass('fill-surface', 'stroke-line-strong');
    expect(screen.getByText('Still to come')).toBeInTheDocument();
  });

  it('leaves “Still to come” out of the legend when every day is over', () => {
    const { square } = draw(november(SALES), '2026-11-30');
    expect(square(30)).not.toHaveAttribute('data-step', 'to-come');
    expect(screen.queryByText('Still to come')).not.toBeInTheDocument();
  });

  it('says what each step holds, from nothing sold up', () => {
    draw();
    const legend = screen
      .getByText('Nothing sold')
      .closest('ul') as HTMLElement;
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Nothing sold',
      '₹1–₹250',
      '₹251–₹500',
      '₹501–₹750',
      '₹751–₹1,000',
      'Still to come',
    ]);
  });

  it('gives a day’s numbers under the pointer, outlining it, and stops when the pointer leaves', () => {
    const { svg, square, readout } = draw();

    expect(readout).toHaveTextContent(HINT);
    const x = Number(square(3).getAttribute('x')) + 3;
    const y = Number(square(3).getAttribute('y')) + 3;
    fireEvent.pointerMove(svg, { clientX: x, clientY: y });
    expect(readout).toHaveTextContent('3 November: ₹250');
    expect(square(3)).toHaveClass('stroke-ink');

    // Before the 1st, in its week: no day.
    const first = Number(square(1).getAttribute('y'));
    fireEvent.pointerMove(svg, {
      clientX: Number(square(1).getAttribute('x')) + 3,
      clientY: first - 20,
    });
    expect(readout).toHaveTextContent(HINT);

    fireEvent.pointerMove(svg, { clientX: x, clientY: y });
    fireEvent.pointerLeave(svg);
    expect(readout).toHaveTextContent(HINT);
    expect(square(3)).not.toHaveClass('stroke-ink');
  });

  it('gives the keyboard a range over the days, from the last', async () => {
    const user = userEvent.setup();
    const { readout } = draw();

    await user.tab();
    expect(range()).toHaveFocus();
    expect(range()).toHaveAttribute('max', '29');
    expect(range()).toHaveAttribute('aria-valuetext', '30 November: ₹0');
    fireEvent.change(range(), { target: { value: '5' } });
    expect(readout).toHaveTextContent('6 November: ₹-428');
  });

  it('shows every day as a table, a button away', async () => {
    const user = userEvent.setup();
    draw();

    await user.click(screen.getByRole('button', { name: 'Show as a table' }));
    const table = screen.getByRole('table', {
      name: 'Sales each day, as a calendar',
    });
    expect(within(table).getAllByRole('row')).toHaveLength(31);
  });

  it('names each month over the week its 1st falls in, unless too close to the last', () => {
    const days: CalendarDay[] = Array.from({ length: 70 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 9, 28 + i))
        .toISOString()
        .slice(0, 10);
      return { day, value: 0, readout: day, cells: [day] };
    });
    const { texts } = draw(days, '2027-01-01');
    // From 28 October: November's 1st only four days on, so October goes.
    expect(
      texts().filter(
        (text) =>
          text?.length === 3 &&
          text !== 'Mon' &&
          text !== 'Wed' &&
          text !== 'Fri',
      ),
    ).toEqual(['Nov', 'Dec', 'Jan']);
  });
});
