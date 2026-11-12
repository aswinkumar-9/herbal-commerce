import type { Transition, Variants } from 'motion/react';

// The console's motion (ADR 0031): short and calm, so it never slows staff
// down. The computer's "reduce motion" setting turns it off (MotionConfig
// in main.tsx, and the CSS in index.css).
export const DURATION = { fast: 0.15, base: 0.2, slow: 0.25 } as const;

// Quick to start, soft to land.
export const EASE_OUT = [0.2, 0, 0, 1] as const;

export const transition: Transition = {
  duration: DURATION.base,
  ease: EASE_OUT,
};

// A page or a card arriving: it fades in and rises a little. Leaving is
// quicker than arriving.
export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition },
  gone: {
    opacity: 0,
    y: -4,
    transition: { duration: DURATION.fast, ease: EASE_OUT },
  },
};

// A list whose rows arrive one after another, quickly enough that a long
// list still settles in a moment.
export const STAGGER = 0.03;
export const staggered: Variants = {
  shown: { transition: { staggerChildren: STAGGER } },
};
