import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast, over, parseHex } from '../src/color.ts';

test('reads #rgb and #rrggbb, and refuses anything else', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('#2E6A44'), [46, 106, 68]);
  assert.throws(() => parseHex('rgb(0 0 0)'), /Not a #rgb or #rrggbb colour/);
  assert.throws(() => parseHex('#12345'), /Not a #rgb/);
});

test('measures contrast as WCAG does', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#ffffff', '#000000'), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  // A known pair: #767676 is the lightest grey with 4.5:1 on white.
  assert.ok(contrast('#767676', '#ffffff') >= 4.5);
  assert.ok(contrast('#777777', '#ffffff') < 4.5);
});

test('paints a see-through colour over another', () => {
  assert.deepEqual(over('#ffffff', 0.88, '#000000'), [224, 224, 224]);
  assert.deepEqual(over('#000000', 0.5, '#ffffff'), [128, 128, 128]);
  assert.deepEqual(over('#2e6a44', 1, '#ffffff'), [46, 106, 68]);
});
