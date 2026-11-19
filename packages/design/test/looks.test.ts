import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast, over, parseHex } from '../src/color.ts';
import { COLOR_TOKENS, CONTRAST } from '../src/foundations.ts';
import { LOOKS } from '../src/index.ts';

const THEMES = ['light', 'dark'] as const;

for (const look of LOOKS) {
  test(`${look.name}: every colour is a hex value, the same names in both themes`, () => {
    const light = Object.keys(look.colors.light);
    assert.deepEqual(Object.keys(look.colors.dark), light);
    for (const token of COLOR_TOKENS) {
      assert.ok(light.includes(token), token);
    }
    for (const theme of THEMES) {
      for (const [name, value] of Object.entries(look.colors[theme])) {
        assert.doesNotThrow(() => parseHex(value ?? ''), `${theme} ${name}`);
      }
    }
  });

  for (const theme of THEMES) {
    const palette = look.colors[theme];
    const colour = (name: string) => {
      const value = palette[name];
      assert.ok(value, `${look.name} has no colour ${name}`);
      return value;
    };

    for (const pair of look.pairs) {
      const name = `${look.name}, ${theme}: ${pair.what} (${pair.fore} on ${pair.back}) keeps ${pair.min}:1`;
      test(name, pair.gap ? { todo: pair.gap } : {}, () => {
        const ratio = contrast(colour(pair.fore), colour(pair.back));
        assert.ok(ratio >= pair.min, `${ratio.toFixed(2)}:1`);
      });
    }

    // The worst the glass can show through: black under it in the light
    // theme, white in the dark one.
    const under = theme === 'light' ? '#000000' : '#ffffff';
    for (const glass of look.glass ?? []) {
      const behind = over(colour('surface'), glass.alpha, under);
      for (const token of glass.text) {
        test(`${look.name}, ${theme}: ${token} text on ${glass.what} keeps ${CONTRAST.text}:1 at worst`, () => {
          const ratio = contrast(colour(token), behind);
          assert.ok(ratio >= CONTRAST.text, `${ratio.toFixed(2)}:1`);
        });
      }
    }
  }

  if (look.scrim) {
    const { alpha, text } = look.scrim;
    test(`${look.name}: text on the scrim keeps ${CONTRAST.text}:1 over the whitest picture`, () => {
      const ratio = contrast(text, over('#000000', alpha, '#ffffff'));
      assert.ok(ratio >= CONTRAST.text, `${ratio.toFixed(2)}:1`);
    });
  }

  test(`${look.name}: motion settles within a second, on the grid`, () => {
    assert.equal(look.motion.ease.length, 4);
    for (const [name, seconds] of Object.entries(look.motion.durations)) {
      assert.ok(seconds > 0 && seconds <= 1, name);
    }
    assert.ok(look.motion.rise % 4 === 0 && look.motion.rise <= 32);
    assert.ok(look.motion.stagger > 0 && look.motion.stagger <= 0.1);
  });
}
