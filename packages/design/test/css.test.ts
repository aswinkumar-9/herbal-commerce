import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { colorNames } from '../src/css.ts';
import { TEXT_STYLES } from '../src/foundations.ts';
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
    for (const name of colorNames(look.colors.light)) {
      assert.match(light ?? '', new RegExp(`\\n  --${name}: #`), name);
      assert.match(dark ?? '', new RegExp(`\\n    --${name}: #`), name);
      assert.ok(css.includes(`--color-${name}: var(--${name});`), name);
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
    assert.doesNotMatch(css, /https?:|url\(\s*['"]?\/\//);
    // Only the look's own imports, from packages on the same server.
    const imports = [...css.matchAll(/@import '([^']+)';/g)].map((m) => m[1]);
    assert.deepEqual(imports, [...(look.imports ?? [])]);
    for (const file of imports) {
      assert.match(file ?? '', /^@fontsource\/[a-z-]+\/[a-z0-9-]+\.css$/);
    }
  });
}

const shop = LOOKS.find((look) => look.name === 'shop');

test('shop: light by default, dark as the device asks or the switch says', () => {
  assert.ok(shop);
  const css = cssFor(shop);
  assert.ok(css.includes(':root {\n  color-scheme: light;'));
  assert.ok(
    css.includes(
      "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n    color-scheme: dark;",
    ),
  );
  assert.ok(css.includes(":root[data-theme='dark'] {\n  color-scheme: dark;"));
  // The switch's dark block holds every dark colour.
  const forced = css.split(":root[data-theme='dark'] {")[1]?.split('\n}')[0];
  for (const name of colorNames(shop.colors.dark)) {
    assert.ok(forced?.includes(`--${name}: ${shop.colors.dark[name]};`), name);
  }
});

test('console: follows the computer only, with no switch', () => {
  const look = LOOKS.find(({ name }) => name === 'console');
  assert.ok(look);
  const css = cssFor(look);
  assert.ok(css.includes(':root {\n  color-scheme: light dark;'));
  assert.ok(!css.includes('data-theme'));
});
