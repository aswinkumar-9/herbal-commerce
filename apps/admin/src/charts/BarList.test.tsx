import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BarList, type BarListItem } from './BarList';

function item(
  key: string,
  value: number,
  extra: Partial<BarListItem> = {},
): BarListItem {
  return { key, name: key, value, figure: `₹${value}`, ...extra };
}

// The bar drawn in a row: its x and width, in percent; none when it has none.
function barOf(row: HTMLElement) {
  const bar = row.querySelector(':scope > svg rect.fill-series');
  return bar
    ? {
        x: bar.getAttribute('x'),
        width: bar.getAttribute('width'),
        height: bar.getAttribute('height'),
      }
    : null;
}

describe('BarList', () => {
  it('ranks rows on one scale, each with its name, figure and note, the largest the full width', () => {
    render(
      <BarList
        label="Best states"
        items={[
          item('Karnataka', 1350, { note: '3 orders' }),
          item('Kerala', 675, { note: '1 order' }),
          item('Goa', 0),
        ]}
      />,
    );

    const list = screen.getByRole('list', { name: 'Best states' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Karnataka₹1350 · 3 orders',
      'Kerala₹675 · 1 order',
      'Goa₹0',
    ]);
    expect(barOf(rows[0] as HTMLElement)).toEqual({
      x: '0%',
      width: '100%',
      height: '8',
    });
    expect(barOf(rows[1] as HTMLElement)).toEqual({
      x: '0%',
      width: '50%',
      height: '8',
    });
    // Nothing to draw for 0, and no zero line while nothing is below 0.
    expect(barOf(rows[2] as HTMLElement)).toBeNull();
    expect(list.querySelector('rect.fill-line-strong')).toBeNull();
  });

  it('reaches left of a zero line for a value below 0', () => {
    render(
      <BarList
        label="Payment methods"
        items={[item('UPI', 750), item('Not recorded', -250)]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(barOf(rows[0] as HTMLElement)).toEqual({
      x: '25%',
      width: '75%',
      height: '8',
    });
    expect(barOf(rows[1] as HTMLElement)).toEqual({
      x: '0%',
      width: '25%',
      height: '8',
    });
    for (const row of rows) {
      expect(row.querySelector('rect.fill-line-strong')).toHaveAttribute(
        'x',
        '25%',
      );
    }
  });

  it('puts the zero line where a child below 0 needs it, though its row is above 0', () => {
    render(
      <BarList
        label="Best categories"
        items={[
          item('Wellness', 400, {
            children: [item('Immunity', 600), item('Sleep', -200)],
          }),
        ]}
      />,
    );

    const [wellness, immunity, sleep] = screen.getAllByRole('listitem');
    expect(barOf(wellness as HTMLElement)).toEqual({
      x: '25%',
      width: '50%',
      height: '8',
    });
    expect(barOf(immunity as HTMLElement)).toMatchObject({
      x: '25%',
      width: '75%',
    });
    expect(barOf(sleep as HTMLElement)).toMatchObject({
      x: '0%',
      width: '25%',
    });
  });

  it('shows a row’s children under it, a little in and thinner, on the same scale', () => {
    render(
      <BarList
        label="Best categories"
        items={[
          item('Wellness', 800, {
            children: [item('Immunity', 600), item('Sleep', 200)],
          }),
          item('Herbal Teas', 400),
        ]}
      />,
    );

    const list = screen.getByRole('list', { name: 'Best categories' });
    const [wellness] = within(list).getAllByRole('listitem');
    const children = within(wellness as HTMLElement).getAllByRole('listitem');
    expect(children.map((row) => row.firstElementChild?.textContent)).toEqual([
      'Immunity₹600',
      'Sleep₹200',
    ]);
    expect(children[0]).toHaveClass('pl-4');
    expect(barOf(children[0] as HTMLElement)).toEqual({
      x: '0%',
      width: '75%',
      height: '4',
    });
    expect(barOf(children[1] as HTMLElement)).toEqual({
      x: '0%',
      width: '25%',
      height: '4',
    });
  });
});

describe('choosing a row', () => {
  it('makes each pickable row’s name a button, pressed while chosen', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <BarList
        label="States"
        items={[
          {
            key: 'Kerala',
            name: 'Kerala',
            value: 900,
            figure: '₹900',
            pickable: true,
          },
          {
            key: 'Goa',
            name: 'Goa',
            value: 300,
            figure: '₹300',
            pickable: true,
          },
          { key: 'gone', name: 'Not recorded', value: 40, figure: '₹40' },
        ]}
        onPick={onPick}
        picked={(item) => item.key === 'Goa'}
      />,
    );
    const kerala = screen.getByRole('button', { name: 'Kerala' });
    expect(kerala).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Goa' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Not recorded' })).toBeNull();
    await user.click(kerala);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'Kerala' }),
    );
  });

  it('has no buttons without a way to choose', () => {
    render(
      <BarList
        label="States"
        items={[
          {
            key: 'Kerala',
            name: 'Kerala',
            value: 900,
            figure: '₹900',
            pickable: true,
          },
        ]}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
