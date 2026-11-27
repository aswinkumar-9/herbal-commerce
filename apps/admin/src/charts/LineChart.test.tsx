import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { type LinePoint, LineChart } from './LineChart';

const HINT = 'Point at the chart, or use the arrow keys, to see its numbers.';

function day(n: number, value: number, previous: number): LinePoint {
  return {
    key: `2026-11-${String(n).padStart(2, '0')}`,
    label: `${n} Nov`,
    value,
    previous,
    readout: `${n} November: ₹${value}. Period before: ₹${previous}`,
    cells: [`${n} November`, `₹${value}`, `₹${previous}`],
  };
}

const WEEK = [
  day(1, 120, 300),
  day(2, 0, 0),
  day(3, 900, 450),
  day(4, -428, 120),
  day(5, 449, 200),
];

function draw(points = WEEK) {
  const view = render(
    <LineChart
      label="Sales each day"
      points={points}
      tableHeaders={['Day', 'This period', 'Period before']}
      names={{ now: 'This period', before: 'Period before, 6–10 Oct' }}
    />,
  );
  const svg = view.container.querySelector('svg[width="640"]');
  if (!svg) {
    throw new Error('no chart drawn');
  }
  const line = (which: 'now' | 'before') =>
    svg.querySelector(`path[data-line="${which}"]`);
  const dot = (which: 'now' | 'before') =>
    svg.querySelector(`circle[data-dot="${which}"]`);
  const texts = () =>
    [...svg.querySelectorAll('text')].map((t) => t.textContent);
  const readout = view.container.querySelector('p[aria-hidden="true"]');
  return { svg, line, dot, texts, readout };
}

const range = () => screen.getByRole('slider', { name: 'Sales each day' });
// The points of a line, as its path draws them.
const pointsOf = (path: Element | null) =>
  [
    ...(path?.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g),
  ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

describe('LineChart', () => {
  it('draws this period in the series green over the period before in grey, both through every point, on a clean axis', () => {
    const { line, texts, svg } = draw();

    const now = line('now');
    const before = line('before');
    expect(now).toHaveClass('stroke-series');
    expect(now).toHaveAttribute('stroke-width', '2');
    expect(now).toHaveAttribute('fill', 'none');
    expect(before).toHaveClass('stroke-line-strong');
    // Behind: drawn first.
    expect(
      (before as Node).compareDocumentPosition(now as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const nowPoints = pointsOf(now);
    const beforePoints = pointsOf(before);
    expect(nowPoints).toHaveLength(5);
    expect(beforePoints).toHaveLength(5);
    // The same days at the same places along the axis.
    expect(nowPoints.map((p) => p.x)).toEqual(beforePoints.map((p) => p.x));
    // ₹900 above ₹450, and −₹428 below ₹120.
    expect(nowPoints[2]?.y).toBeLessThan(beforePoints[2]?.y ?? 0);
    expect(nowPoints[3]?.y).toBeGreaterThan(beforePoints[3]?.y ?? 0);
    expect(texts()).toEqual(
      expect.arrayContaining(['−₹500', '₹0', '₹500', '₹1,000']),
    );
    expect(
      [...svg.querySelectorAll('line')].filter((l) =>
        l.classList.contains('stroke-line-strong'),
      ),
    ).toHaveLength(1);
  });

  it('stretches the axis to the period before when it sold more, so its line stays on the chart', () => {
    const { line, texts } = draw([day(1, 100, 2000), day(2, 50, 1500)]);

    expect(texts()).toContain('₹2,000');
    for (const { y } of pointsOf(line('before'))) {
      expect(y).toBeGreaterThanOrEqual(12);
    }
  });

  it('writes things counted whole as whole numbers, not rupees', () => {
    const view = render(
      <LineChart
        label="Customers each day"
        points={[day(1, 9, 4), day(2, 6, 7)]}
        tableHeaders={['Day', 'Customers']}
        names={{ now: 'This period', before: 'Period before' }}
        counts
      />,
    );
    const texts = [
      ...(view.container
        .querySelector('svg[width="640"]')
        ?.querySelectorAll('text') ?? []),
    ].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(['0', '5', '10']));
    expect(texts.some((text) => text?.includes('₹'))).toBe(false);
    expect(texts).not.toContain('7.5');
  });

  it('names both lines in a legend, each beside a short line of its colour', () => {
    draw();
    const legend = screen.getByRole('list');
    const items = within(legend).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'This period',
      'Period before, 6–10 Oct',
    ]);
    expect(items[0]?.querySelector('line')).toHaveClass('stroke-series');
    expect(items[1]?.querySelector('line')).toHaveClass('stroke-line-strong');
  });

  it('marks the latest point, and under the pointer finds the nearest day with a hairline and both periods’ numbers', () => {
    const { svg, dot, line, readout } = draw();

    expect(readout).toHaveTextContent(HINT);
    expect(dot('now')).toHaveClass('fill-series', 'stroke-surface');
    expect(dot('now')).toHaveAttribute('r', '4');
    expect(dot('before')).toBeNull();
    expect(svg.querySelector('[data-crosshair]')).toBeNull();

    fireEvent.pointerMove(svg, { clientX: -100 });
    expect(readout).toHaveTextContent('1 November: ₹120. Period before: ₹300');
    const crosshair = svg.querySelector('[data-crosshair]');
    expect(crosshair).not.toBeNull();
    expect(dot('before')).toHaveClass('fill-line-strong');
    expect(dot('now')?.getAttribute('cx')).toBe(crosshair?.getAttribute('x1'));

    fireEvent.pointerMove(svg, { clientX: 100_000 });
    expect(readout).toHaveTextContent('5 November: ₹449');

    // Nearer the 2nd than the 1st: the 2nd.
    const [first, second] = pointsOf(line('now'));
    fireEvent.pointerMove(svg, {
      clientX: (first?.x ?? 0) + 0.6 * ((second?.x ?? 0) - (first?.x ?? 0)),
    });
    expect(readout).toHaveTextContent('2 November: ₹0');

    fireEvent.pointerLeave(svg);
    expect(readout).toHaveTextContent(HINT);
    expect(svg.querySelector('[data-crosshair]')).toBeNull();
  });

  it('gives the keyboard a range along the line, from the latest', async () => {
    const user = userEvent.setup();
    const { readout } = draw();

    await user.tab();
    expect(range()).toHaveFocus();
    expect(range()).toHaveAttribute('max', '4');
    expect(range()).toHaveValue('4');
    expect(range()).toHaveAttribute(
      'aria-valuetext',
      '5 November: ₹449. Period before: ₹200',
    );
    fireEvent.change(range(), { target: { value: '2' } });
    expect(readout).toHaveTextContent('3 November: ₹900. Period before: ₹450');

    await user.tab();
    expect(readout).toHaveTextContent(HINT);
  });

  it('shows both periods as a table, a button away', async () => {
    const user = userEvent.setup();
    draw();

    await user.click(screen.getByRole('button', { name: 'Show as a table' }));
    const table = screen.getByRole('table', { name: 'Sales each day' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toHaveTextContent('3 November₹900₹450');
  });

  it('draws one day as a dot, and nothing without days', () => {
    const one = draw([day(1, 449, 0)]);
    expect(pointsOf(one.line('now'))).toHaveLength(1);
    expect(one.dot('now')).not.toBeNull();

    render(
      <LineChart
        label="Nothing"
        points={[]}
        tableHeaders={['Day']}
        names={{ now: 'This period', before: 'Before' }}
      />,
    );
    expect(screen.queryByRole('slider', { name: 'Nothing' })).toBeNull();
  });
});
