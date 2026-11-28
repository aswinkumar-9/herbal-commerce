import { type RefObject, useEffect, useState } from 'react';

// The width a chart has, followed as its card grows and shrinks (part 15D,
// ADR 0047). Before it is measured, and where it can't be (the tests), 640.
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      setWidth(measured > 0 ? measured : 640);
    };
    measure();
    const watch =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    watch?.observe(element);
    return () => watch?.disconnect();
  }, [ref]);
  return width;
}
