import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast, over, parseHex } from '../src/color.ts';
import { COLOR_TOKENS, CONTRAST } from '../src/foundations.ts';
import { LOOKS } from '../src/index.ts';

const THEMES = ['light', 'dark'] as const;

for (const look of LOOKS) {
  test(`${look.name}: every colour is a hex value, in both themes`, () => {
    for (const theme of THEMES) {
      assert.deepEqual(
        Object.keys(look.colors[theme]).sort(),
        [...COLOR_TOKENS].sort(),
      );
      for (const [token, value] of Object.entries(look.colors[theme])) {
        assert.doesNotThrow(() => parseHex(value), `${theme} ${token}`);
      }
    }
  });

  for (const theme of THEMES) {
    const palette = look.colors[theme];
    for (const pair of look.pairs) {
      const name = `${look.name}, ${theme}: ${pair.what} (${pair.fore} on ${pair.back}) keeps ${pair.min}:1`;
      test(name, pair.gap ? { todo: pair.gap } : {}, () => {
        const ratio = contrast(palette[pair.fore], palette[pair.back]);
        assert.ok(ratio >= pair.min, `${ratio.toFixed(2)}:1`);
      });
    }

    if (look.glass) {
      const { alpha, text } = look.glass;
      // The worst the glass can show through: black under it in the light
      // theme, white in the dark one.
      const under = theme === 'light' ? '#000000' : '#ffffff';
      const glass = over(palette.surface, alpha, under);
      for (const token of text) {
        test(`${look.name}, ${theme}: ${token} text on glass keeps ${CONTRAST.text}:1 at worst`, () => {
          const ratio = contrast(palette[token], glass);
          assert.ok(ratio >= CONTRAST.text, `${ratio.toFixed(2)}:1`);
        });
      }
    }
  }

  test(`${look.name}: motion is quick enough to never hold anyone up`, () => {
    assert.equal(look.motion.ease.length, 4);
    for (const [name, seconds] of Object.entries(look.motion.durations)) {
      assert.ok(seconds > 0 && seconds <= 1, name);
    }
    assert.ok(look.motion.rise % 4 === 0 && look.motion.rise <= 32);
  });
}
