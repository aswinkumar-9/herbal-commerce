import type { ColorToken } from './foundations.ts';

// A look: what one side (the console, the shop) wears on top of the shared
// foundations. Written as data, so the CSS for the web and the values for
// the apps come from the same place, and tests can check it.

export type Palette = Readonly<Record<ColorToken, string>>;

// Values that belong together, with why they are as they are.
export interface Group {
  readonly comment?: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface Look {
  // Its CSS is css/<name>.css, and its own rules src/looks/<name>.rules.css.
  readonly name: string;
  // Who it is for and what it is like, at the top of its CSS.
  readonly summary: string;
  // Every colour token, in each theme. Hex only, so contrast can be checked.
  readonly colors: { readonly light: Palette; readonly dark: Palette };
  // More CSS variables, such as glows and shadows, in each theme.
  readonly effects: {
    readonly light: readonly Group[];
    readonly dark: readonly Group[];
  };
  // More of Tailwind's theme: corners, shadows, the font.
  readonly theme: readonly Group[];
  readonly motion: {
    // A cubic Bézier curve, as Motion and CSS take it.
    readonly ease: readonly [number, number, number, number];
    // In seconds.
    readonly durations: Readonly<Record<string, number>>;
    // How far something rises as it arrives, in pixels.
    readonly rise: number;
    // Between items of a list arriving one after another, in seconds.
    readonly stagger: number;
  };
  // Text, icons and edges that must keep their contrast in both themes.
  readonly pairs: readonly {
    readonly fore: ColorToken;
    readonly back: ColorToken;
    readonly min: number;
    readonly what: string;
    // A gap that is known and planned, not yet fixed: reported, not failed.
    readonly gap?: string;
  }[];
  // Glass: how solid it is, and the text that sits on it. Its text must
  // keep its contrast even with black under it (white in the dark theme).
  readonly glass?: {
    readonly alpha: number;
    readonly text: readonly ColorToken[];
  };
}
