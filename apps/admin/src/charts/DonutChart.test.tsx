import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type DonutPart, DonutChart } from './DonutChart';

const METHODS: DonutPart[] = [
  { key: 'UPI', name: 'UPI', value: 600, colour: 1, figure: '₹600' },
  { key: 'CARD', name: 'Card', value: 300, colour: 2, figure: '₹300' },
  { key: 'WALLET', name: 'Wallet', value: 0, colour: 4, figure: '₹0' },
  {
    key: 'NONE',
    name: 'Not recorded',
    value: 100,
    colour: 'other',
    figure: '₹100',
  },
];

function draw(parts = METHODS) {
  const view = render(
    <DonutChart
      label="Sales by payment method"
      parts={parts}
      total={{ value: '₹1,000', caption: 'in sales' }}
    />,
  );
  const svg = view.container.querySelector('svg[aria-hidden="true"]');
  if (!svg) {
    throw new Error('no chart drawn');
  }
  const drawn = () => [...svg.querySelectorAll('[data-part]')];
  const legend = screen.getByRole('list', { name: 'Sales by payment method' });
  const rows = () => within(legend).getAllByRole('listitem');
  return { svg, drawn, legend, rows };
}

// The angle a piece of the ring starts at, from where its path begins.
function startOf(piece: Element): number {
  const [, x, y] =
    /^M(-?[\d.]+) (-?[\d.]+)/.exec(piece.getAttribute('d') ?? '') ?? [];
  const angle = Math.atan2(Number(x) - 88, 88 - Number(y));
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

describe('DonutChart', () => {
  it('draws each part above 0 in its own colour, in the order given, apart by the card’s colour', () => {
    const { drawn } = draw();

    expect(drawn().map((piece) => piece.getAttribute('data-part'))).toEqual([
      'UPI',
      'CARD',
      'NONE',
    ]);
    expect(drawn()[0]).toHaveClass('fill-series-1', 'stroke-surface');
    expect(drawn()[1]).toHaveClass('fill-series-2');
    expect(drawn()[2]).toHaveClass('fill-series-other');
    for (const piece of drawn()) {
      expect(piece).toHaveAttribute('stroke-width', '2');
    }
    // Clockwise from 12 o'clock, each as big as its share: UPI 60%, then
    // Card 30%.
    const [upi, card, none] = drawn().map(startOf);
    expect(upi).toBeCloseTo(0, 5);
    expect(card).toBeCloseTo(0.6 * 2 * Math.PI, 3);
    expect(none).toBeCloseTo(0.9 * 2 * Math.PI, 3);
    // More than half goes the long way round; less, the short.
    expect(drawn()[0]?.getAttribute('d')).toContain('0 1 1');
    expect(drawn()[1]?.getAttribute('d')).toContain('0 0 1');
  });

  it('writes the whole in the middle, and lists every part with its figures and share, none hidden', () => {
    const { svg, rows } = draw();

    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(
      ['₹1,000', 'in sales'],
    );
    expect(rows().map((row) => row.textContent)).toEqual([
      'UPI₹60060%',
      'Card₹30030%',
      'Wallet₹00%',
      'Not recorded₹10010%',
    ]);
    expect(rows()[0]?.querySelector('span')).toHaveClass('bg-series-1');
    expect(rows()[3]?.querySelector('span')).toHaveClass('bg-series-other');
  });

  it('picks out a part and its row together, from the ring or from the legend', () => {
    const { drawn, rows, svg } = draw();

    fireEvent.pointerEnter(drawn()[1] as Element);
    expect(rows()[1]).toHaveClass('bg-surface-muted');
    expect(drawn()[0]).toHaveClass('opacity-40');
    expect(drawn()[1]).not.toHaveClass('opacity-40');

    fireEvent.pointerLeave(svg);
    expect(rows()[1]).not.toHaveClass('bg-surface-muted');
    expect(drawn()[0]).not.toHaveClass('opacity-40');

    fireEvent.pointerEnter(rows()[0] as Element);
    expect(drawn()[1]).toHaveClass('opacity-40');
    expect(drawn()[0]).not.toHaveClass('opacity-40');
    fireEvent.pointerLeave(rows()[0] as Element);
    expect(drawn()[1]).not.toHaveClass('opacity-40');
  });

  it('draws one part as a whole ring, and nothing at all as an empty one', () => {
    const one = draw([METHODS[0] as DonutPart, METHODS[2] as DonutPart]);
    expect(one.drawn()).toHaveLength(1);
    expect(one.drawn()[0]?.tagName.toLowerCase()).toBe('circle');
    expect(one.drawn()[0]).toHaveClass('stroke-series-1');
    expect(one.rows().map((row) => row.textContent)).toEqual([
      'UPI₹600100%',
      'Wallet₹00%',
    ]);

    const none = render(
      <DonutChart
        label="Nothing yet"
        parts={[METHODS[2] as DonutPart]}
        total={{ value: '₹0', caption: 'in sales' }}
      />,
    );
    expect(none.container.querySelectorAll('[data-part]')).toHaveLength(0);
    expect(none.container.querySelector('circle')).toHaveClass(
      'stroke-surface-muted',
    );
  });

  it('says a tiny part is less than 1%', () => {
    const { rows } = draw([
      { key: 'UPI', name: 'UPI', value: 99_950, colour: 1, figure: '₹99,950' },
      { key: 'EMI', name: 'EMI', value: 50, colour: 5, figure: '₹50' },
    ]);
    expect(rows()[1]).toHaveTextContent('less than 1%');
  });
});

describe('choosing a part', () => {
  it('makes each pickable part’s name in the legend a button, pressed while chosen', () => {
    const chosen: string[] = [];
    render(
      <DonutChart
        label="Sales by payment method"
        parts={METHODS.map((part) => ({
          ...part,
          pickable: part.key !== 'NONE',
        }))}
        total={{ value: '₹1,000', caption: 'in sales' }}
        onPick={(part) => chosen.push(part.key)}
        picked={(part) => part.key === 'CARD'}
      />,
    );
    expect(screen.getByRole('button', { name: 'UPI' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Card' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Not recorded' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }));
    expect(chosen).toEqual(['UPI']);
  });
});
