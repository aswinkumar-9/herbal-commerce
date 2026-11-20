import { act, render, screen } from '@testing-library/react';
import { SHOP_MOTION } from '@herbal/design';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Reveal, Tagline } from './components/Reveal.tsx';
import { mediaMatches } from './test/setup.ts';
import { FakeObserver, fakeObservers, report } from './test/observer.ts';

beforeEach(fakeObservers);
afterEach(() => {
  vi.unstubAllGlobals();
});

const part = () => screen.getByText('A part').parentElement as HTMLElement;
const animate = () => vi.mocked(Element.prototype.animate);

describe('a part rising into view', () => {
  function renderPart() {
    render(
      <Reveal>
        <p>A part</p>
      </Reveal>,
    );
  }

  it('stays as it is when it is in view from the start', () => {
    renderPart();
    act(() => report([part()], true));
    expect(part().style.opacity).toBe('');
    expect(animate()).not.toHaveBeenCalled();
  });

  it('waits out of view, then rises 32 px and fades in once, on the shop’s curve', () => {
    renderPart();
    act(() => report([part()], false));
    expect(part().style.opacity).toBe('0');
    act(() => report([part()], true));
    expect(part().style.opacity).toBe('');
    expect(animate()).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate().mock.calls[0] ?? [];
    expect(keyframes).toEqual([
      { opacity: 0, translate: `0 ${SHOP_MOTION.rise}px` },
      { opacity: 1, translate: '0 0' },
    ]);
    expect(options).toMatchObject({
      duration: SHOP_MOTION.durations.reveal * 1000,
      easing: `cubic-bezier(${SHOP_MOTION.ease.join(', ')})`,
      fill: 'backwards',
    });
    // Once only: the watcher has let it go.
    expect(
      FakeObserver.all.every((watcher) => watcher.watched.size === 0),
    ).toBe(true);
  });

  it('only fades when the device asks for less motion', () => {
    mediaMatches.set('(prefers-reduced-motion: reduce)', true);
    renderPart();
    act(() => report([part()], false));
    act(() => report([part()], true));
    expect(animate().mock.calls[0]?.[0]).toEqual([
      { opacity: 0 },
      { opacity: 1 },
    ]);
  });

  it('lets parts arriving together follow one another, 60 ms apart', () => {
    render(
      <>
        <Reveal>
          <p>One</p>
        </Reveal>
        <Reveal>
          <p>Two</p>
        </Reveal>
      </>,
    );
    const parts = ['One', 'Two'].map(
      (name) => screen.getByText(name).parentElement as HTMLElement,
    );
    act(() => report(parts, false));
    act(() => report(parts, true));
    const delays = animate().mock.calls.map(
      ([, options]) => (options as KeyframeAnimationOptions).delay,
    );
    expect(delays).toEqual([0, SHOP_MOTION.stagger * 1000]);
  });

  it('shows everything as it is where the browser can’t watch', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    Reflect.deleteProperty(window, 'IntersectionObserver');
    renderPart();
    expect(part().style.opacity).toBe('');
  });
});

describe('the tagline', () => {
  const LINES = ['From our fields to your home,', 'every herb grown slowly'];
  const words = () => [
    ...document.querySelectorAll<HTMLElement>('[data-word]'),
  ];
  const line = () => document.querySelector('p') as HTMLElement;

  it('is made fully lit, every word its own, and reads as its sentence', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    Reflect.deleteProperty(window, 'IntersectionObserver');
    render(<Tagline lines={LINES} />);
    expect(words().map((word) => word.textContent)).toEqual(
      LINES.join(' ').split(' '),
    );
    expect(line().textContent?.replace(/\s+/g, ' ').trim()).toBe(
      LINES.join(' '),
    );
    expect(line()).not.toHaveAttribute('data-armed');
  });

  it('lights the words already past the line at once, then quiets the rest', () => {
    render(<Tagline lines={LINES} />);
    const [first, second, ...rest] = words();
    act(() => report([first!, second!], true));
    expect(first).toHaveAttribute('data-lit');
    expect(second).toHaveAttribute('data-lit');
    expect(first!.style.transitionDelay).toBe('0s');
    expect(line()).toHaveAttribute('data-armed');
    for (const word of rest) {
      expect(word).not.toHaveAttribute('data-lit');
    }
  });

  it('lights each later word in turn, in reading order', () => {
    render(<Tagline lines={LINES} />);
    const all = words();
    act(() => report([all[0]!], true));
    act(() => report([all[1]!, all[2]!, all[3]!], true));
    expect(all.slice(1, 4).map((word) => word.style.transitionDelay)).toEqual([
      '0s',
      `${SHOP_MOTION.stagger}s`,
      `${2 * SHOP_MOTION.stagger}s`,
    ]);
    expect(all.slice(1, 4).every((word) => word.hasAttribute('data-lit'))).toBe(
      true,
    );
  });

  it('watches for the line 60% of the way up the screen', () => {
    render(<Tagline lines={LINES} />);
    expect(FakeObserver.all[0]?.options?.rootMargin).toBe('0px 0px -40% 0px');
  });

  it('is simply shown when the device asks for less motion', () => {
    mediaMatches.set('(prefers-reduced-motion: reduce)', true);
    render(<Tagline lines={LINES} />);
    expect(FakeObserver.all).toHaveLength(0);
    expect(line()).not.toHaveAttribute('data-armed');
  });
});
