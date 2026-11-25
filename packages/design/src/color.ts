// Contrast, as WCAG 2.2 measures it, for colours written as #rgb or
// #rrggbb.

export type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const parts = short
    ? [short[1], short[2], short[3]].map((digit) => `${digit}${digit}`)
    : long
      ? [long[1], long[2], long[3]]
      : null;
  if (!parts) {
    throw new Error(`Not a #rgb or #rrggbb colour: ${hex}`);
  }
  const [r, g, b] = parts.map((part) => parseInt(part ?? '', 16));
  return [r ?? 0, g ?? 0, b ?? 0];
}

// A channel of sRGB, from 0 to 255, as light, from 0 to 1.
const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

// How bright a colour looks, from 0 (black) to 1 (white).
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// A colour as OKLCH (Björn Ottosson's OKLab, in polar form): how light it
// looks, from 0 to 1, how much colour it has (0 is grey), and its hue in
// degrees. Charts are checked with it (CHART_COLOUR).
export function oklch(colour: Rgb | string): {
  l: number;
  c: number;
  h: number;
} {
  const rgb = typeof colour === 'string' ? parseHex(colour) : colour;
  const [r, g, b] = rgb.map(linear) as unknown as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bee = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: lightness,
    c: Math.hypot(a, bee),
    h: ((Math.atan2(bee, a) * 180) / Math.PI + 360) % 360,
  };
}

// From 1 (no difference) to 21 (black on white).
export function contrast(a: Rgb | string, b: Rgb | string): number {
  const [one, two] = [a, b].map((colour) =>
    luminance(typeof colour === 'string' ? parseHex(colour) : colour),
  );
  const lighter = Math.max(one ?? 0, two ?? 0);
  const darker = Math.min(one ?? 0, two ?? 0);
  return (lighter + 0.05) / (darker + 0.05);
}

// A see-through colour over another, as the browser paints it.
export function over(
  top: Rgb | string,
  alpha: number,
  bottom: Rgb | string,
): Rgb {
  const [t, b] = [top, bottom].map((colour) =>
    typeof colour === 'string' ? parseHex(colour) : colour,
  ) as [Rgb, Rgb];
  return [0, 1, 2].map((i) =>
    Math.round(alpha * (t[i] ?? 0) + (1 - alpha) * (b[i] ?? 0)),
  ) as unknown as Rgb;
}
