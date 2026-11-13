import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TOAST_MS, ToastProvider } from './ToastProvider';
import { useToasts } from './toast-context';
import type { ToastKind } from './toast-context';

let show: (message: string, kind?: ToastKind) => void = () => undefined;

// Hands the test the page's way to show a note.
function Page() {
  const toasts = useToasts();
  useEffect(() => {
    show = toasts.show;
  }, [toasts]);
  return <p>Categories</p>;
}

function renderToasts() {
  render(
    <ToastProvider>
      <Page />
    </ToastProvider>,
  );
  return screen.getByRole('status', { name: 'Notifications' });
}

function useTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

// Still showing: on real timers (the note's own timer stays behind on the
// fake clock), and after time enough for a leaving note to slide away.
async function stillThere(text: string) {
  vi.useRealTimers();
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  expect(screen.getByText(text)).toBeInTheDocument();
}

// Its time is up: it slides away (on real timers, as animations run).
async function gone(text: string) {
  vi.useRealTimers();
  await waitFor(() => expect(screen.queryByText(text)).not.toBeInTheDocument());
}

describe('the notes', () => {
  it('are read out by a screen reader: the region is there before any note', () => {
    const region = renderToasts();

    expect(region).toBeEmptyDOMElement();
    act(() => show('Hair Care saved'));

    expect(region).toHaveTextContent('Hair Care saved');
  });

  it.each([
    ['success', TOAST_MS.success],
    ['error', TOAST_MS.error],
  ] as const)('go away on their own: %s after %i ms', async (kind, ms) => {
    useTimers();
    renderToasts();
    act(() => show('Hair Care saved', kind));

    act(() => vi.advanceTimersByTime(ms));

    await gone('Hair Care saved');
  });

  it.each([
    ['success', TOAST_MS.success],
    ['error', TOAST_MS.error],
  ] as const)('stay until then: %s at %i ms less one', async (kind, ms) => {
    useTimers();
    renderToasts();
    act(() => show('Hair Care saved', kind));

    act(() => vi.advanceTimersByTime(ms - 1));

    await stillThere('Hair Care saved');
  });

  it('give problems longer than successes', () => {
    expect(TOAST_MS).toEqual({ success: 5000, error: 8000 });
  });

  it('stay while the pointer is on them', async () => {
    useTimers();
    renderToasts();
    act(() => show('Hair Care saved'));
    const note = screen.getByText('Hair Care saved');

    fireEvent.pointerEnter(note);
    act(() => vi.advanceTimersByTime(TOAST_MS.success * 3));

    await stillThere('Hair Care saved');
  });

  it('go once the pointer leaves', async () => {
    useTimers();
    renderToasts();
    act(() => show('Hair Care saved'));
    const note = screen.getByText('Hair Care saved');

    fireEvent.pointerEnter(note);
    act(() => vi.advanceTimersByTime(TOAST_MS.success * 3));
    fireEvent.pointerLeave(note);
    act(() => vi.advanceTimersByTime(TOAST_MS.success));

    await gone('Hair Care saved');
  });

  it('stay while the focus is on them', async () => {
    useTimers();
    renderToasts();
    act(() => show('Hair Care saved'));

    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus());
    act(() => vi.advanceTimersByTime(TOAST_MS.success * 3));

    await stillThere('Hair Care saved');
  });

  it('go when dismissed', async () => {
    renderToasts();
    act(() => show('Hair Care saved'));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() =>
      expect(screen.queryByText('Hair Care saved')).not.toBeInTheDocument(),
    );
  });

  it('are at most three: the oldest goes', async () => {
    renderToasts();
    act(() => {
      for (const name of ['One', 'Two', 'Three', 'Four']) {
        show(`${name} saved`);
      }
    });

    await waitFor(() =>
      expect(screen.queryByText('One saved')).not.toBeInTheDocument(),
    );
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(3);
  });

  it('cannot be used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Page />)).toThrow(
      'useToasts is used outside the ToastProvider',
    );
  });
});
