import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchBox } from './SearchBox';

// A page with a search box above a list, saying each time it is drawn.
function Page({ onDraw = () => undefined }: { onDraw?: () => void }) {
  onDraw();
  const [current, setCurrent] = useState('');
  return (
    <>
      <SearchBox
        label="Search by name"
        current={current}
        onSearch={(text) => setCurrent(text.trim())}
      />
      <button type="button" onClick={() => setCurrent('')}>
        Clear the filters
      </button>
      <p>Showing: {current || 'everything'}</p>
    </>
  );
}

const box = () => screen.getByRole('searchbox', { name: 'Search by name' });

describe('SearchBox', () => {
  it('redraws only itself while typing: the page is drawn again once the search is sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const draw = vi.fn();
      const user = userEvent.setup({
        advanceTimers: (ms) => vi.advanceTimersByTime(ms),
      });
      render(<Page onDraw={draw} />);
      const before = draw.mock.calls.length;

      await user.type(box(), 'tulsi');
      expect(draw).toHaveBeenCalledTimes(before);

      await act(() => vi.advanceTimersByTimeAsync(300));
      expect(screen.getByText('Showing: tulsi')).toBeInTheDocument();
      expect(draw).toHaveBeenCalledTimes(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps what is typed, spaces and all, when its own search comes back', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(box(), 'tulsi ');
    await screen.findByText('Showing: tulsi');

    expect(box()).toHaveValue('tulsi ');
    await user.type(box(), 'tea');
    expect(box()).toHaveValue('tulsi tea');
  });

  it('follows the page when the search is cleared from outside', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.type(box(), 'tulsi');
    await screen.findByText('Showing: tulsi');
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));

    expect(screen.getByText('Showing: everything')).toBeInTheDocument();
    expect(box()).toHaveValue('');
  });
});
