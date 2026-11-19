import { readFileSync } from 'node:fs';
import { lookCss } from '../src/css.ts';
import type { Look } from '../src/look.ts';

// Where a look's CSS is written, and the CSS it should hold.
export const cssFile = (look: Look) =>
  new URL(`../css/${look.name}.css`, import.meta.url);

export function cssFor(look: Look): string {
  const rules = readFileSync(
    new URL(`../src/looks/${look.name}.rules.css`, import.meta.url),
    'utf8',
  );
  return lookCss(look, rules.replace(/\r\n/g, '\n'));
}
