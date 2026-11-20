// The shop's motion (ADR 0036, the website's rules B7 and B11): parts of a
// page rise into view as the customer reaches them, once, and the tagline
// lights up word by word. The page is made on the server with everything
// shown, so it reads well before the script runs, and without it. Only
// what is still out of view waits to arrive; what is in view at the start
// stays as it is. Styles are set on the elements' style objects, which the
// security policy allows, never as style attributes.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { SHOP_MOTION } from '@herbal/design';

const EASE = `cubic-bezier(${SHOP_MOTION.ease.join(', ')})`;
const ms = (seconds: number): number => seconds * 1000;

export const lessMotion = (): boolean =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

const canWatch = (): boolean =>
  typeof window !== 'undefined' && 'IntersectionObserver' in window;

// A part rises 32 px and fades in over 700 ms as it comes into view. With
// less motion asked for, it only fades. Parts that arrive together follow
// one another, 60 ms apart. One watcher serves every part on the page, so
// it knows which arrive together; it closes when the last part leaves.
let watcher: IntersectionObserver | undefined;
// Each part still waiting, and whether its first report has come.
const waiting = new Map<Element, { reported: boolean }>();

function revealWatcher(): IntersectionObserver {
  watcher ??= new IntersectionObserver(
    (entries) => {
      let arriving = 0;
      for (const entry of entries) {
        const part = waiting.get(entry.target);
        const node = entry.target;
        if (!part || !(node instanceof HTMLElement)) {
          continue;
        }
        const first = !part.reported;
        part.reported = true;
        if (!entry.isIntersecting) {
          // Out of view at the start: hidden until it arrives.
          if (first) {
            node.style.opacity = '0';
          }
          continue;
        }
        stopWatching(node);
        // In view at the start: it stays as it is.
        if (first) {
          continue;
        }
        node.style.opacity = '';
        node.animate(
          lessMotion()
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { opacity: 0, translate: `0 ${SHOP_MOTION.rise}px` },
                { opacity: 1, translate: '0 0' },
              ],
          {
            duration: ms(SHOP_MOTION.durations.reveal),
            delay: ms(arriving++ * SHOP_MOTION.stagger),
            easing: EASE,
            fill: 'backwards',
          },
        );
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  return watcher;
}

function stopWatching(node: Element): void {
  waiting.delete(node);
  watcher?.unobserve(node);
  if (waiting.size === 0) {
    watcher?.disconnect();
    watcher = undefined;
  }
}

export function useReveal<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !canWatch()) {
      return;
    }
    waiting.set(node, { reported: false });
    revealWatcher().observe(node);
    return () => {
      stopWatching(node);
      node.style.opacity = '';
    };
  }, []);
  return ref;
}

// The tagline starts quiet and lights up word by word, in reading order,
// as each word passes 60% of the way up the screen. Words already past it
// when the page starts are lit at once. With less motion asked for, it is
// simply shown.
export function useTagline<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const line = ref.current;
    if (!line || !canWatch() || lessMotion()) {
      return;
    }
    const words = [...line.querySelectorAll<HTMLElement>('[data-word]')];
    let first = true;
    const watch = new IntersectionObserver(
      (entries) => {
        entries
          .filter((entry) => entry.isIntersecting)
          .forEach(({ target }, index) => {
            watch.unobserve(target);
            if (target instanceof HTMLElement) {
              target.style.transitionDelay = first
                ? '0s'
                : `${index * SHOP_MOTION.stagger}s`;
              target.dataset['lit'] = '';
            }
          });
        // Quiet only once the words already past the line are lit.
        if (first) {
          first = false;
          line.dataset['armed'] = '';
        }
      },
      { rootMargin: '0px 0px -40% 0px' },
    );
    for (const word of words) {
      watch.observe(word);
    }
    return () => {
      watch.disconnect();
      delete line.dataset['armed'];
      for (const word of words) {
        delete word.dataset['lit'];
        word.style.transitionDelay = '';
      }
    };
  }, []);
  return ref;
}
