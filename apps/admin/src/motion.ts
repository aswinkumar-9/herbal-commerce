import { CONSOLE_MOTION } from '@herbal/design';
import type { Transition, Variants } from 'motion/react';

// The console's motion (ADR 0031), from the design system (ADR 0036): short
// and calm, so it never slows staff down. The computer's "reduce motion"
// setting turns it off (MotionConfig in main.tsx, and the design system's
// CSS).
export const DURATION = CONSOLE_MOTION.durations;

// Quick to start, soft to land.
export const EASE_OUT = CONSOLE_MOTION.ease;

export const transition: Transition = {
  duration: DURATION.base,
  ease: EASE_OUT,
};

// A page or a card arriving: it fades in and rises a little. Leaving is
// quicker than arriving.
export const rise: Variants = {
  hidden: { opacity: 0, y: CONSOLE_MOTION.rise },
  shown: { opacity: 1, y: 0, transition },
  gone: {
    opacity: 0,
    y: -4,
    transition: { duration: DURATION.fast, ease: EASE_OUT },
  },
};

// A list whose rows arrive one after another, quickly enough that a long
// list still settles in a moment.
export const STAGGER = CONSOLE_MOTION.stagger;
export const staggered: Variants = {
  shown: { transition: { staggerChildren: STAGGER } },
};
