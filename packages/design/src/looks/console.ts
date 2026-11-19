import { CONTRAST } from '../foundations.ts';
import type { Look } from '../look.ts';

// Short and calm, so it never slows staff down: quick to start, soft to
// land (ADR 0031). The console's Motion animations read these.
export const CONSOLE_MOTION = {
  ease: [0.2, 0, 0, 1],
  // In seconds.
  durations: { fast: 0.15, base: 0.2, slow: 0.25 },
  // How far a page or a card rises as it arrives, in pixels.
  rise: 8,
  // Between the rows of a list arriving one after another, in seconds.
  stagger: 0.03,
} as const;

// The admin console's look, for Admins and Super Users (ADR 0031, ADR 0035):
// calm herbal greens on warm neutrals, glass and clay on a soft glow. Light
// or dark as the computer is set. Staff read numbers here all day, so text
// always sits on a solid colour or on glass that is nearly solid.
export const consoleLook: Look = {
  name: 'console',
  summary: `The admin console's look (ADR 0035): glass and clay on a soft herbal glow,
   light or dark as the computer is set.
   - Glass (the \`glass\` class): bars that float over the page, such as the
     menu and the save bar. Frosted, so the page shows through softly.
   - Clay (shadow-clay*, inset-shadow-clay): cards, buttons and chips look
     soft and raised, lit from above.
   - Wells (inset-shadow-well): fields look pressed into the page.
   - Pressed (inset-shadow-pressed): a chosen filter, or a button held down.
   Components use the colour names (bg-canvas, text-ink, bg-primary ...),
   never raw colours, so both themes follow.`,
  colors: {
    light: {
      canvas: '#f6f7f2',
      surface: '#ffffff',
      'surface-muted': '#eef2ea',
      line: '#dce3d5',
      ink: '#1d2820',
      'ink-muted': '#56665a',
      primary: '#2e6a44',
      'primary-strong': '#245536',
      'primary-soft': '#e2eee5',
      'on-primary': '#ffffff',
      accent: '#b7832f',
      danger: '#b42318',
      'danger-strong': '#912018',
      'danger-soft': '#fdecea',
      'on-danger': '#ffffff',
      warning: '#8a5a12',
      'warning-soft': '#fbf0dc',
      focus: '#3f8f5c',
    },
    dark: {
      canvas: '#111613',
      surface: '#181f1a',
      'surface-muted': '#202924',
      line: '#2c3830',
      ink: '#e6ece5',
      'ink-muted': '#a0afa4',
      primary: '#6dbb88',
      'primary-strong': '#86c99d',
      'primary-soft': '#1d3125',
      'on-primary': '#0d1a12',
      accent: '#d9a656',
      danger: '#f08c80',
      'danger-strong': '#f5a89f',
      'danger-soft': '#3a1d1a',
      'on-danger': '#2a0d0a',
      warning: '#e3b363',
      'warning-soft': '#33281a',
      focus: '#86c99d',
    },
  },
  effects: {
    light: [
      {
        comment:
          'The glow behind the page: faint, so text on the page keeps its contrast.',
        values: {
          'glow-green': 'rgb(46 106 68 / 0.08)',
          'glow-amber': 'rgb(183 131 47 / 0.07)',
          'glow-mint': 'rgb(109 187 136 / 0.1)',
        },
      },
      {
        comment:
          'Glass: the surface, a little see-through. Solid enough that muted text on it keeps 4.5:1 even with black under it (white in the dark theme).',
        values: {
          glass: 'color-mix(in oklab, var(--surface) 88%, transparent)',
          'glass-edge': 'rgb(255 255 255 / 0.65)',
        },
      },
      {
        comment: 'Clay: light from above, a soft shadow below.',
        values: {
          'clay-highlight': 'rgb(255 255 255 / 0.9)',
          'clay-shade': 'rgb(20 40 26 / 0.045)',
          'clay-shadow-sm':
            '0 1px 2px rgb(20 40 26 / 0.07), 0 3px 8px -3px rgb(20 40 26 / 0.12)',
          'clay-shadow':
            '0 1px 2px rgb(20 40 26 / 0.05), 0 8px 20px -6px rgb(20 40 26 / 0.12)',
          'clay-shadow-lg':
            '0 2px 4px rgb(20 40 26 / 0.05), 0 20px 44px -12px rgb(20 40 26 / 0.24)',
          'chip-shadow': 'rgb(20 40 26 / 0.1)',
          'well-shadow': 'rgb(20 40 26 / 0.07)',
          'pressed-shadow': 'rgb(20 40 26 / 0.16)',
        },
      },
    ],
    dark: [
      {
        values: {
          'glow-green': 'rgb(109 187 136 / 0.07)',
          'glow-amber': 'rgb(217 166 86 / 0.045)',
          'glow-mint': 'rgb(46 106 68 / 0.14)',
          glass: 'color-mix(in oklab, var(--surface) 88%, transparent)',
          'glass-edge': 'rgb(255 255 255 / 0.05)',
          'clay-highlight': 'rgb(255 255 255 / 0.07)',
          'clay-shade': 'rgb(0 0 0 / 0.22)',
          'clay-shadow-sm':
            '0 1px 2px rgb(0 0 0 / 0.35), 0 3px 8px -3px rgb(0 0 0 / 0.45)',
          'clay-shadow':
            '0 1px 2px rgb(0 0 0 / 0.3), 0 8px 20px -6px rgb(0 0 0 / 0.5)',
          'clay-shadow-lg':
            '0 2px 4px rgb(0 0 0 / 0.3), 0 20px 44px -12px rgb(0 0 0 / 0.65)',
          'chip-shadow': 'rgb(0 0 0 / 0.35)',
          'well-shadow': 'rgb(0 0 0 / 0.3)',
          'pressed-shadow': 'rgb(0 0 0 / 0.45)',
        },
      },
    ],
  },
  theme: [
    {
      values: {
        'radius-card': '1rem',
        'radius-control': '0.75rem',
      },
    },
    {
      comment:
        'Raised clay: chips, then buttons and rows, then cards, then what floats above the page (dialogs, toasts).',
      values: {
        'shadow-chip': '0 1px 2px var(--chip-shadow)',
        'shadow-clay-sm': 'var(--clay-shadow-sm)',
        'shadow-clay': 'var(--clay-shadow)',
        'shadow-clay-lg': 'var(--clay-shadow-lg)',
      },
    },
    {
      comment:
        'Inside a raised shape: lit at the top edge, a little shade at the bottom. On a coloured button, the same in white and black.',
      values: {
        'inset-shadow-clay':
          'inset 0 1px 0 var(--clay-highlight), inset 0 -2px 4px var(--clay-shade)',
        'inset-shadow-clay-solid':
          'inset 0 1px 0 rgb(255 255 255 / 0.22), inset 0 -2px 0 rgb(0 0 0 / 0.12)',
        'inset-shadow-glass': 'inset 0 1px 0 var(--glass-edge)',
        'inset-shadow-well': 'inset 0 1px 3px var(--well-shadow)',
        'inset-shadow-pressed': 'inset 0 2px 5px var(--pressed-shadow)',
        'inset-shadow-pressed-solid': 'inset 0 2px 6px rgb(0 0 0 / 0.28)',
      },
    },
    {
      comment: "The computer's own font: nothing is fetched from another site.",
      values: {
        'font-sans':
          "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      },
    },
  ],
  motion: CONSOLE_MOTION,
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
      fore: 'ink-muted',
      back: 'primary-soft',
      min: CONTRAST.text,
      what: 'quiet text in a chosen row',
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
      back: 'surface-muted',
      min: CONTRAST.text,
      what: 'a link on a muted box',
    },
    {
      fore: 'primary-strong',
      back: 'primary-soft',
      min: CONTRAST.text,
      what: 'a chip, the open menu item',
    },
    {
      fore: 'on-primary',
      back: 'primary',
      min: CONTRAST.text,
      what: 'a main button',
    },
    {
      fore: 'on-primary',
      back: 'primary-strong',
      min: CONTRAST.text,
      what: 'a main button under the pointer',
    },
    {
      fore: 'danger',
      back: 'canvas',
      min: CONTRAST.text,
      what: 'an error on the page',
    },
    {
      fore: 'danger',
      back: 'surface',
      min: CONTRAST.text,
      what: 'an error on a card',
    },
    {
      fore: 'danger',
      back: 'danger-soft',
      min: CONTRAST.text,
      what: 'an error box, "Out of stock"',
    },
    {
      fore: 'on-danger',
      back: 'danger',
      min: CONTRAST.text,
      what: 'a delete button',
    },
    {
      fore: 'on-danger',
      back: 'danger-strong',
      min: CONTRAST.text,
      what: 'a delete button under the pointer',
    },
    {
      fore: 'warning',
      back: 'canvas',
      min: CONTRAST.text,
      what: 'a warning on the page',
    },
    {
      fore: 'warning',
      back: 'surface',
      min: CONTRAST.text,
      what: 'a warning on a card',
    },
    {
      fore: 'warning',
      back: 'warning-soft',
      min: CONTRAST.text,
      what: '"Low", "Stops selling soon"',
    },
    {
      fore: 'accent',
      back: 'surface',
      min: CONTRAST.ui,
      what: "the idle warning's icon",
    },
    {
      fore: 'focus',
      back: 'canvas',
      min: CONTRAST.ui,
      what: 'the focus ring on the page',
    },
    {
      fore: 'focus',
      back: 'surface',
      min: CONTRAST.ui,
      what: 'the focus ring on a card',
    },
    {
      fore: 'line',
      back: 'surface',
      min: CONTRAST.ui,
      what: "a field's edge on a card",
      gap: 'Fields are edged in the divider colour, 1.31:1 (light) and 1.37:1 (dark). A stronger edge for fields is planned after the console moves onto this package.',
    },
  ],
  glass: { alpha: 0.88, text: ['ink', 'ink-muted', 'danger'] },
};
