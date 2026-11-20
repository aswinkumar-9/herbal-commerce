import { useId, useMemo } from 'react';
import { encode } from 'uqr';

// A QR code drawn as one SVG path, one square for each dark module: no
// image, and nothing turned into HTML, so the console's policy stays as it
// is. Always dark on white, in either theme, with the wide quiet border
// scanners need: a light-on-dark code does not scan in every app. Screen
// readers hear the caption, as the code means nothing to them.
export function QrCode({ value, label }: { value: string; label: string }) {
  const captionId = useId();
  const { size, path } = useMemo(() => {
    const code = encode(value, { ecc: 'M', border: 4 });
    let d = '';
    code.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) {
          d += `M${x} ${y}h1v1h-1z`;
        }
      });
    });
    return { size: code.size, path: d };
  }, [value]);

  return (
    <figure aria-labelledby={captionId} className="shrink-0">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        className="size-48 rounded-lg bg-white shadow-chip"
      >
        <rect width={size} height={size} fill="#ffffff" />
        <path d={path} fill="#000000" />
      </svg>
      <figcaption id={captionId} className="sr-only">
        {label}
      </figcaption>
    </figure>
  );
}
