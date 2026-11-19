import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBottomBar } from './bottom-bar';

function Bar() {
  const bar = useBottomBar<HTMLDivElement>();
  return <div ref={bar}>2 chosen</div>;
}

const reserved = () =>
  document.documentElement.style.getPropertyValue('--bottom-bar');

describe('a bar at the bottom of the page', () => {
  it('says how much of the bottom it takes while it is there, so the notes rise above it', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 834, 900, 65.4),
    );

    const { unmount } = render(<Bar />);

    expect(reserved()).toBe('66px');
    unmount();
    expect(reserved()).toBe('');
  });
});
