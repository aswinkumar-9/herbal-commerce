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

// How bright a colour looks, from 0 (black) to 1 (white).
export function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
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
