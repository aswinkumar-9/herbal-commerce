import { COLOR_TOKENS, LAYERS, TEXT_STYLES } from './foundations.ts';
import type { Group, Look } from './look.ts';

// Writes a look as CSS for Tailwind 4: its colours and effects as CSS
// variables in both themes, the names Tailwind makes classes of, the rules
// every look shares, then the look's own rules.

const WIDTH = 80;

// Tailwind's names for the weights.
const TAILWIND_WEIGHT = {
  regular: 'normal',
  medium: 'medium',
  semibold: 'semibold',
  bold: 'bold',
} as const;

// A comment, wrapped to the width, its lines lined up after the opening.
function comment(text: string, indent = ''): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const lead = lines.length === 0 ? `${indent}/* ` : `${indent}   `;
    if (line && (lead + line + ' ' + word).length > WIDTH - 3) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines
    .map((text, i) => `${i === 0 ? `${indent}/* ` : `${indent}   `}${text}`)
    .join('\n')
    .concat(' */');
}

function declaration(name: string, value: string, indent: string): string {
  const one = `${indent}--${name}: ${value};`;
  return one.length <= WIDTH
    ? one
    : `${indent}--${name}:\n${indent}  ${value};`;
}

function groups(list: readonly Group[], indent: string): string[] {
  return list.flatMap((group) => [
    ...(group.comment ? [comment(group.comment, indent)] : []),
    ...Object.entries(group.values).map(([name, value]) =>
      declaration(name, value, indent),
    ),
  ]);
}

function colors(palette: Look['colors']['light'], indent: string): string[] {
  return COLOR_TOKENS.map((token) =>
    declaration(token, palette[token], indent),
  );
}

// The rules every look shares (ADR 0036).
function foundations(): string {
  const styles = Object.entries(TEXT_STYLES).map(
    ([name, { step, weight }]) => `@utility ${name} {
  font-size: var(--text-${step});
  line-height: var(--text-${step}--line-height);
  font-weight: var(--font-weight-${TAILWIND_WEIGHT[weight]});
}`,
  );
  return [
    comment('Focus is always visible, in the look’s own colour.'),
    `:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}`,
    comment(
      '"Reduce motion" on the computer turns CSS motion off. An app’s own animations follow it too (Motion: MotionConfig reducedMotion="user").',
    ),
    `@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`,
    comment(
      'The named text styles: every text is one of these, the same names in every look (heading-1 … heading-6, title-1 … title-5, body-1 … body-6, button-lg … button-xsm, caption-1 … caption-5).',
    ),
    ...styles,
  ].join('\n\n');
}

export function lookCss(look: Look, rules: string): string {
  const root = [
    '  color-scheme: light dark;',
    ...colors(look.colors.light, '  '),
    '',
    ...groups(look.effects.light, '  '),
    '',
    comment('What sits above what (z-index), from the page up.', '  '),
    ...Object.entries(LAYERS).map(([name, value]) =>
      declaration(`layer-${name}`, String(value), '  '),
    ),
  ];
  const dark = [
    ...colors(look.colors.dark, '    '),
    '',
    ...groups(look.effects.dark, '    '),
  ];
  const theme = [
    ...COLOR_TOKENS.map((token) =>
      declaration(`color-${token}`, `var(--${token})`, '  '),
    ),
    ...groups(look.theme, '  '),
  ];
  return [
    comment(
      `Made by packages/design (ADR 0036) from src/looks/${look.name}.ts and src/looks/${look.name}.rules.css. Don't edit it by hand: change the look, then run \`pnpm design:build\`.`,
    ),
    `/* ${look.summary} */`,
    `:root {\n${root.join('\n')}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root {\n${dark.join('\n')}\n  }\n}`,
    `@theme inline {\n${theme.join('\n')}\n}`,
    foundations(),
    comment(`The ${look.name}'s own rules.`),
    rules.trim(),
  ]
    .join('\n\n')
    .concat('\n');
}
