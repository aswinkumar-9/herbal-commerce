// The arithmetic of the console's charts (part 15D, ADR 0047), as plain
// functions, so they are easy to test.

// Whole rupees, grouped the Indian way, with a true minus for less than
// nothing: ₹1,00,000 and −₹428.
export function signedRupees(amount: number): string {
  const whole = `₹${Math.abs(amount).toLocaleString('en-IN')}`;
  return amount < 0 ? `−${whole}` : whole;
}

const COMPACT = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

// How an axis writes its rupees: in full below ₹10,000, and short the
// Indian way once the axis reaches it (₹10K, ₹1.5L, ₹1Cr). One style for
// the whole axis.
export function tickFormat(
  ticks: readonly number[],
): (amount: number) => string {
  const reach = Math.max(0, ...ticks.map(Math.abs));
  if (reach < 10_000) {
    return signedRupees;
  }
  return (amount) => {
    const short = `₹${COMPACT.format(Math.abs(amount))}`;
    return amount < 0 ? `−${short}` : short;
  };
}

// A clean step near the rough one: 1, 2, 2.5 or 5, times a power of ten.
function cleanStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.find((candidate) => candidate * power >= rough) ?? 10;
  return step * power;
}

export interface Scale {
  // The lowest and highest the axis shows, 0 always among them.
  low: number;
  high: number;
  // Clean numbers for the gridlines, low to high, 0 among them.
  ticks: number[];
}

// An axis for these values: from 0, or below it when one is below 0, to
// about `count` clean steps. Nothing but 0 still gives an axis.
export function scaleFor(values: readonly number[], count = 4): Scale {
  const least = Math.min(0, ...values);
  const most = Math.max(0, ...values);
  if (least === most) {
    return { low: 0, high: 1, ticks: [0] };
  }
  // Whole rupees: the step is never below one.
  const step = Math.max(1, cleanStep((most - least) / count));
  const low = Math.floor(least / step) * step;
  const high = Math.ceil(most / step) * step;
  const ticks: number[] = [];
  for (let tick = low; tick <= high + step / 2; tick += step) {
    ticks.push(Math.round(tick * 100) / 100);
  }
  return { low, high, ticks };
}

// A column from the baseline to its value, rounded only at its data end:
// the top when it rises, the bottom when it falls below the baseline. None
// for a value of 0.
export function columnPath(
  x: number,
  width: number,
  baseline: number,
  end: number,
  radius = 4,
): string | null {
  const height = Math.abs(baseline - end);
  if (height < 0.5) {
    return null;
  }
  const r = Math.min(radius, width / 2, height);
  const right = x + width;
  if (end < baseline) {
    // Rises: square at the baseline, round at the top.
    return [
      `M${x} ${baseline}`,
      `V${end + r}`,
      `Q${x} ${end} ${x + r} ${end}`,
      `H${right - r}`,
      `Q${right} ${end} ${right} ${end + r}`,
      `V${baseline}`,
      'Z',
    ].join(' ');
  }
  // Falls below the baseline: round at the bottom.
  return [
    `M${x} ${baseline}`,
    `V${end - r}`,
    `Q${x} ${end} ${x + r} ${end}`,
    `H${right - r}`,
    `Q${right} ${end} ${right} ${end - r}`,
    `V${baseline}`,
    'Z',
  ].join(' ');
}

// Which of n labels under the columns to show, so they never touch: the
// first, then every so many, and the last, at most `room` of them.
export function labelledColumns(n: number, room: number): Set<number> {
  const shown = new Set<number>();
  if (n === 0) {
    return shown;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(1, room)));
  for (let i = 0; i < n; i += every) {
    shown.add(i);
  }
  const last = n - 1;
  // The last always shows. Unless it falls on the step, the one before it
  // is nearer than a step, so it goes.
  if (last % every !== 0) {
    shown.delete(last - (last % every));
  }
  shown.add(last);
  return shown;
}
