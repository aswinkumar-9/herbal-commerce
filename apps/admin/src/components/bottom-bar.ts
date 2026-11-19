import { useEffect, useRef } from 'react';

// A bar kept at the bottom of the page, such as a product's save bar or the
// bar for packing several orders, says how much of the bottom it takes
// (--bottom-bar on the page), so the notes (ToastProvider) rise above it
// and never lie over its buttons. Set through the CSSOM, which the policy
// allows; gone with the bar.
export function useBottomBar<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar) {
      return;
    }
    const root = document.documentElement;
    const measure = () => {
      const offset = Number.parseFloat(getComputedStyle(bar).bottom) || 0;
      const height = bar.getBoundingClientRect().height;
      root.style.setProperty('--bottom-bar', `${Math.ceil(height + offset)}px`);
    };
    measure();
    // It grows when its buttons wrap onto a second line.
    const watch =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    watch?.observe(bar);
    return () => {
      watch?.disconnect();
      root.style.removeProperty('--bottom-bar');
    };
  }, []);
  return ref;
}
