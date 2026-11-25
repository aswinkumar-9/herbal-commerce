// The foundations every look shares (ADR 0036): one grid, one type scale
// with named text styles, the corners, the screen widths, the layers and the
// contrast rules. The console, the website and the apps differ in their look
// (src/looks/), never in these.

// Everything sits on a 4 px grid: Tailwind's spacing unit (0.25rem).
export const GRID_PX = 4;

// The named spacing steps, in pixels. The shop uses only these. The console
// may use any step of the grid. 2 px is the one half step, for hairlines.
export const SPACING = {
  'spacing-0': 0,
  'spacing-25': 2,
  'spacing-50': 4,
  'spacing-75': 8,
  'spacing-100': 12,
  'spacing-200': 16,
  'spacing-300': 24,
  'spacing-400': 32,
  'spacing-500': 40,
  'spacing-600': 48,
  'spacing-700': 64,
  'spacing-800': 80,
  'spacing-900': 96,
} as const;

// Text sizes: Tailwind's scale, each with its line height, in pixels.
export const TYPE_SCALE = {
  xs: { size: 12, lineHeight: 16 },
  sm: { size: 14, lineHeight: 20 },
  base: { size: 16, lineHeight: 24 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 20, lineHeight: 28 },
  '2xl': { size: 24, lineHeight: 32 },
  '3xl': { size: 30, lineHeight: 36 },
  '4xl': { size: 36, lineHeight: 40 },
  '5xl': { size: 48, lineHeight: 48 },
  '6xl': { size: 60, lineHeight: 60 },
  '7xl': { size: 72, lineHeight: 72 },
  '8xl': { size: 96, lineHeight: 96 },
  '9xl': { size: 128, lineHeight: 128 },
} as const;
export type TypeStep = keyof typeof TYPE_SCALE;

// Never thinner than regular, never heavier than bold.
export const WEIGHTS = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;
export type Weight = keyof typeof WEIGHTS;

// Every text is one of these named styles, the same names in every look:
// headings for pages and sections, titles for what leads a block, body for
// running text, buttons for buttons only, captions for small print. Each is
// a step of the scale, so no style brings a size of its own.
export const TEXT_STYLES = {
  'heading-1': { step: '6xl', weight: 'semibold' },
  'heading-2': { step: '5xl', weight: 'semibold' },
  'heading-3': { step: '4xl', weight: 'semibold' },
  'heading-4': { step: '3xl', weight: 'semibold' },
  'heading-5': { step: '2xl', weight: 'semibold' },
  'heading-6': { step: 'xl', weight: 'semibold' },
  'title-1': { step: 'xl', weight: 'medium' },
  'title-2': { step: 'lg', weight: 'medium' },
  'title-3': { step: 'base', weight: 'medium' },
  'title-4': { step: 'sm', weight: 'medium' },
  'title-5': { step: 'xs', weight: 'medium' },
  'body-1': { step: 'base', weight: 'semibold' },
  'body-2': { step: 'base', weight: 'medium' },
  'body-3': { step: 'base', weight: 'regular' },
  'body-4': { step: 'sm', weight: 'semibold' },
  'body-5': { step: 'sm', weight: 'medium' },
  'body-6': { step: 'sm', weight: 'regular' },
  'button-lg': { step: 'lg', weight: 'semibold' },
  'button-md': { step: 'base', weight: 'semibold' },
  'button-sm': { step: 'sm', weight: 'semibold' },
  'button-xsm': { step: 'xs', weight: 'semibold' },
  'caption-1': { step: 'sm', weight: 'medium' },
  'caption-2': { step: 'sm', weight: 'regular' },
  'caption-3': { step: 'xs', weight: 'semibold' },
  'caption-4': { step: 'xs', weight: 'medium' },
  'caption-5': { step: 'xs', weight: 'regular' },
} as const satisfies Record<string, { step: TypeStep; weight: Weight }>;
export type TextStyle = keyof typeof TEXT_STYLES;

// Corners: Tailwind's radii, in pixels.
export const RADII = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  '3xl': 24,
  '4xl': 32,
} as const;

// A shape inside another: its corner is the outer corner less the gap
// between them, so the two curves run parallel. Only while the gap is under
// 32 px, and only when more than 2 px is left: otherwise the inner shape
// keeps its own corner (undefined). The result is the nearest radius at or
// below it, as only Tailwind's radii are used.
export function nestedRadius(outer: number, gap: number): number | undefined {
  const inner = outer - gap;
  if (gap >= 32 || inner <= 2) {
    return undefined;
  }
  const steps = Object.values(RADII).filter((radius) => radius <= inner);
  return Math.max(...steps);
}

// Screen widths where a layout may change: Tailwind's, in pixels.
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

// What sits above what, from the page up.
export const LAYERS = {
  base: 0,
  // A handle above its own row.
  raised: 10,
  // A bar that sticks while the page scrolls, such as a save bar.
  sticky: 20,
  // The menu bar, above the sticky bars.
  bar: 30,
  // Toasts and the skip link, above everything but a dialog, which the
  // browser puts on its own top layer.
  top: 50,
} as const;

// WCAG 2.2 AA: text against its background, large text (24 px, or 18.66 px
// bold), and the edges and icons that a control needs to be seen.
export const CONTRAST = {
  text: 4.5,
  largeText: 3,
  ui: 3,
} as const;

// A chart's series colour must read as a colour and stand out on its card
// in both themes (part 15D, ADR 0047): OKLCH lightness within the theme's
// band, and chroma at least the floor, below which a hue reads as grey.
// The bands are the data-viz method's.
export const CHART_COLOUR = {
  light: { lightness: [0.43, 0.77] },
  dark: { lightness: [0.48, 0.67] },
  chroma: 0.1,
} as const;

// The colours every look names, so a page reads the same names whatever
// look it wears. Each look gives each a value in the light and dark theme.
export const COLOR_TOKENS = [
  // The page, and the surfaces on it.
  'canvas',
  'surface',
  'surface-muted',
  // Lines that divide, such as between rows: soft, as they only order
  // the page.
  'line',
  // The edge that shows where a control is, such as a field or a switch's
  // track: at least 3:1 against what is around it (WCAG 1.4.11).
  'line-strong',
  // Text: the main ink, and a quieter one.
  'ink',
  'ink-muted',
  // The main colour: actions, links and what is chosen.
  'primary',
  'primary-strong',
  'primary-soft',
  'on-primary',
  // A second colour, for small marks.
  'accent',
  // Something wrong, or a change that can't be undone.
  'danger',
  'danger-strong',
  'danger-soft',
  'on-danger',
  // Needs attention soon.
  'warning',
  'warning-soft',
  // The focus ring.
  'focus',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
