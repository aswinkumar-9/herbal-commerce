import { CONTRAST } from '../foundations.ts';
import type { Look } from '../look.ts';

// The shop's motion, for the customer website and apps (ADR 0036): it
// feels weighted and settles into place, slower than the console's. Only
// transform and opacity move; "reduce motion" leaves only fades.
export const SHOP_MOTION = {
  // Settles: fast at first, a long soft landing.
  ease: [0.22, 1, 0.36, 1],
  // In seconds: a colour or a fade under the pointer, a change of layout,
  // a section revealed as it scrolls into view.
  durations: { hover: 0.3, layout: 0.5, reveal: 0.7 },
  // How far a section rises as it scrolls into view, in pixels (32).
  rise: 32,
  // Between the links of the phone menu as it opens, in seconds...
  stagger: 0.06,
  // ...each rising this far (24 px)...
  menuRise: 24,
  // ...and all of them within this long, however many there are.
  menuCap: 0.4,
} as const;

// The customer shop's look (ADR 0036), from the owner's reference
// (2026-11-20): calm and premium, flat backgrounds, one typeface, big
// pictures. Light or dark as the device is set, with a switch on the page.
// The main colour is neutral (black or white) until the owner's
// illustrations exist: then the accent is chosen from them, by changing
// primary, accent and focus here.
export const shopLook: Look = {
  name: 'shop',
  summary: `The customer shop's look (ADR 0036): calm and premium, flat backgrounds,
   Poppins, and big pictures with text on a scrim.
   - Light or dark as the device is set; the page's switch may choose
     (data-theme="light" or "dark" on <html>, see src/theme.ts).
   - Glass (glass, glass-strong): the floating menu bar and the phone menu.
   - The hero heading (text-hero): a gradient on the text, never the
     background.
   - Text on a picture sits on a scrim (scrim, scrim-fade): white text keeps
     4.5:1 even over the whitest part of the picture.
   - Named text styles (heading-1 ... caption-5) and the spacing steps from
     the foundations only.
   The main colour stays neutral until the owner's illustrations exist.`,
  imports: [
    '@fontsource/poppins/latin-400.css',
    '@fontsource/poppins/latin-500.css',
    '@fontsource/poppins/latin-600.css',
    '@fontsource/poppins/latin-700.css',
  ],
  switchable: true,
  colors: {
    light: {
      canvas: '#fafaf9',
      surface: '#ffffff',
      'surface-muted': '#f3f3f1',
      line: '#e7e7e4',
      'line-strong': '#8a8a84',
      ink: '#111111',
      'ink-muted': '#5f5f5a',
      primary: '#111111',
      'primary-strong': '#2b2b29',
      'primary-soft': '#f0f0ee',
      'on-primary': '#ffffff',
      accent: '#6b6b66',
      danger: '#b42318',
      'danger-strong': '#912018',
      'danger-soft': '#fdecea',
      'on-danger': '#ffffff',
      warning: '#8a5a12',
      'warning-soft': '#fbf0dc',
      focus: '#111111',
      // The hero heading's gradient, left to right.
      'hero-from': '#000000',
      'hero-to': '#666666',
    },
    // The page and its surfaces only in the reference's dark colours:
    // #131209, #1f1f1f, #272727, #313131 (#000000 and #181818 are the
    // others). Status tints (danger-soft, warning-soft) are the exception.
    dark: {
      canvas: '#131209',
      surface: '#1f1f1f',
      'surface-muted': '#272727',
      line: '#313131',
      'line-strong': '#757571',
      ink: '#f5f5f4',
      'ink-muted': '#a8a8a3',
      primary: '#ffffff',
      'primary-strong': '#e7e7e4',
      'primary-soft': '#272727',
      'on-primary': '#111111',
      accent: '#b0b0aa',
      danger: '#f08c80',
      'danger-strong': '#f5a89f',
      'danger-soft': '#3a1d1a',
      'on-danger': '#2a0d0a',
      warning: '#e3b363',
      'warning-soft': '#33281a',
      focus: '#f5f5f4',
      'hero-from': '#ffffff',
      'hero-to': '#9b9b9b',
    },
  },
  effects: {
    light: [
      {
        comment:
          'Glass: the surface, see-through. The menu bar is lighter glass, as only main text sits on it; the phone menu is nearly solid.',
        values: {
          glass: 'color-mix(in oklab, var(--surface) 72%, transparent)',
          'glass-strong':
            'color-mix(in oklab, var(--surface) 94%, transparent)',
          'glass-edge': 'rgb(0 0 0 / 0.06)',
        },
      },
      {
        comment:
          'The scrim behind text on a picture: white text on it keeps 4.5:1 over any picture.',
        values: { scrim: 'rgb(0 0 0 / 0.55)' },
      },
    ],
    dark: [
      {
        values: {
          glass: 'color-mix(in oklab, var(--surface) 72%, transparent)',
          'glass-strong':
            'color-mix(in oklab, var(--surface) 94%, transparent)',
          'glass-edge': 'rgb(255 255 255 / 0.08)',
          scrim: 'rgb(0 0 0 / 0.55)',
        },
      },
    ],
  },
  theme: [
    {
      comment: "Glass's hairline edge, all the way round.",
      values: { 'inset-shadow-glass': 'inset 0 0 0 1px var(--glass-edge)' },
    },
    {
      comment:
        'Poppins, served by the shop itself; the device’s own font while it loads.',
      values: {
        'font-sans': "'Poppins', ui-sans-serif, system-ui, sans-serif",
      },
    },
    {
      comment:
        'Every transition settles into place; under the pointer it takes 300 ms.',
      values: {
        'ease-settle': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'default-transition-timing-function': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'default-transition-duration': '300ms',
      },
    },
  ],
  motion: SHOP_MOTION,
  pairs: [
    {
      fore: 'ink',
      back: 'canvas',
      min: CONTRAST.text,
      what: 'text on the page',
    },
    {
      fore: 'ink',
      back: 'surface',
      min: CONTRAST.text,
      what: 'text on a card',
    },
    {
      fore: 'ink',
      back: 'surface-muted',
      min: CONTRAST.text,
      what: 'text on a muted box',
    },
    {
      fore: 'ink-muted',
      back: 'canvas',
      min: CONTRAST.text,
      what: 'quiet text on the page',
    },
    {
      fore: 'ink-muted',
      back: 'surface',
      min: CONTRAST.text,
      what: 'quiet text on a card',
    },
    {
      fore: 'ink-muted',
      back: 'surface-muted',
      min: CONTRAST.text,
      what: 'quiet text on a muted box',
    },
    {
      fore: 'primary',
      back: 'canvas',
      min: CONTRAST.text,
      what: 'a link on the page',
    },
    {
      fore: 'primary',
      back: 'surface',
      min: CONTRAST.text,
      what: 'a link on a card',
    },
    {
      fore: 'primary',
      back: 'primary-soft',
      min: CONTRAST.text,
      what: 'a chosen chip',
    },
    {
      fore: 'on-primary',
      back: 'primary',
      min: CONTRAST.text,
      what: 'the main button (a pill)',
    },
    {
      fore: 'on-primary',
      back: 'primary-strong',
      min: CONTRAST.text,
      what: 'the main button under the pointer',
    },
    {
      fore: 'danger',
      back: 'surface',
      min: CONTRAST.text,
      what: 'an error under a field',
    },
    {
      fore: 'danger',
      back: 'canvas',
      min: CONTRAST.text,
      what: 'an error on the page',
    },
    {
      fore: 'danger',
      back: 'danger-soft',
      min: CONTRAST.text,
      what: 'an error box',
    },
    {
      fore: 'on-danger',
      back: 'danger',
      min: CONTRAST.text,
      what: 'a button that removes',
    },
    {
      fore: 'warning',
      back: 'warning-soft',
      min: CONTRAST.text,
      what: '"Only a few left"',
    },
    {
      fore: 'warning',
      back: 'surface',
      min: CONTRAST.text,
      what: 'a warning on a card',
    },
    { fore: 'accent', back: 'surface', min: CONTRAST.ui, what: 'a small mark' },
    { fore: 'focus', back: 'canvas', min: CONTRAST.ui, what: 'the focus ring' },
    {
      fore: 'focus',
      back: 'surface',
      min: CONTRAST.ui,
      what: 'the focus ring on a card',
    },
    {
      fore: 'line-strong',
      back: 'surface',
      min: CONTRAST.ui,
      what: "a field's edge",
    },
    {
      fore: 'line-strong',
      back: 'canvas',
      min: CONTRAST.ui,
      what: "a field's edge on the page",
    },
    {
      fore: 'line-strong',
      back: 'surface-muted',
      min: CONTRAST.ui,
      what: "a field's edge on a muted box",
    },
    // The hero heading is large text, but holds 4.5:1 at both ends.
    {
      fore: 'hero-from',
      back: 'canvas',
      min: CONTRAST.text,
      what: "the hero heading's start",
    },
    {
      fore: 'hero-to',
      back: 'canvas',
      min: CONTRAST.text,
      what: "the hero heading's end",
    },
  ],
  glass: [
    { what: 'the floating menu bar', alpha: 0.72, text: ['ink', 'primary'] },
    {
      what: 'the phone menu',
      alpha: 0.94,
      text: ['ink', 'ink-muted', 'primary'],
    },
  ],
  scrim: { alpha: 0.55, text: '#ffffff' },
};
