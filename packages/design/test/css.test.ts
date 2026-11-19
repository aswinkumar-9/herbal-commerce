import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COLOR_TOKENS, TEXT_STYLES } from '../src/foundations.ts';
import { LOOKS } from '../src/index.ts';
import { cssFile, cssFor } from '../scripts/sources.ts';

for (const look of LOOKS) {
  const css = cssFor(look);

  test(`${look.name}: css/${look.name}.css is up to date (run pnpm design:build)`, () => {
    const written = readFileSync(cssFile(look), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(written, css);
  });

  test(`${look.name}: every colour is named for Tailwind, in both themes`, () => {
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    for (const token of COLOR_TOKENS) {
      assert.match(light ?? '', new RegExp(`\\n  --${token}: #`), token);
      assert.match(dark ?? '', new RegExp(`\\n    --${token}: #`), token);
      assert.ok(css.includes(`--color-${token}: var(--${token});`), token);
    }
  });

  test(`${look.name}: the shared rules are there`, () => {
    assert.ok(css.includes(':focus-visible {'));
    assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
    for (const name of Object.keys(TEXT_STYLES)) {
      assert.ok(css.includes(`@utility ${name} {`), name);
    }
  });

  test(`${look.name}: nothing is fetched from another site`, () => {
    assert.doesNotMatch(css, /url\(|@import|https?:/);
  });
}
