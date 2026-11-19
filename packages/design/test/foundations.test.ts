import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BREAKPOINTS,
  GRID_PX,
  LAYERS,
  RADII,
  SPACING,
  TEXT_STYLES,
  TYPE_SCALE,
  WEIGHTS,
  nestedRadius,
} from '../src/foundations.ts';

const rising = (values: number[]) =>
  values.every((value, i) => i === 0 || value > (values[i - 1] ?? 0));

test('spacing sits on the grid, with one half step for hairlines', () => {
  const steps = Object.values(SPACING);
  assert.ok(rising(steps));
  for (const step of steps) {
    assert.ok(step % GRID_PX === 0 || step === GRID_PX / 2, `${step} px`);
  }
});

test("the type scale is Tailwind's, and every line is at least as tall as its text", () => {
  const steps = Object.values(TYPE_SCALE);
  assert.ok(rising(steps.map((step) => step.size)));
  for (const { size, lineHeight } of steps) {
    assert.ok(lineHeight >= size);
    assert.ok(lineHeight % GRID_PX === 0, `${size} px text`);
  }
  assert.deepEqual(TYPE_SCALE.base, { size: 16, lineHeight: 24 });
  assert.deepEqual(TYPE_SCALE.sm, { size: 14, lineHeight: 20 });
});

test('every text style is a step of the scale, never heavier than bold', () => {
  for (const [name, { step, weight }] of Object.entries(TEXT_STYLES)) {
    assert.ok(step in TYPE_SCALE, name);
    assert.ok(WEIGHTS[weight] <= 700, name);
    assert.match(
      name,
      /^(heading|title|body|button|caption)-([1-9]|lg|md|sm|xsm)$/,
    );
  }
  // Within a group, a bigger number is never a bigger size.
  const size = (name: keyof typeof TEXT_STYLES) =>
    TYPE_SCALE[TEXT_STYLES[name].step].size;
  for (const group of ['heading', 'title']) {
    const sizes = Object.keys(TEXT_STYLES)
      .filter((name) => name.startsWith(`${group}-`))
      .map((name) => size(name as keyof typeof TEXT_STYLES));
    assert.ok(
      sizes.every((s, i) => i === 0 || s <= (sizes[i - 1] ?? 0)),
      group,
    );
  }
});

test("a shape's corner inside another is the outer corner less the gap", () => {
  // The reference's example: 16 px outside, 8 px of padding, 8 px inside.
  assert.equal(nestedRadius(RADII['2xl'], 8), RADII.lg);
  assert.equal(nestedRadius(RADII['3xl'], 12), RADII.xl);
  // Snapped down to a radius that exists: 16 − 6 = 10 becomes 8.
  assert.equal(nestedRadius(16, 6), 8);
  // 2 px or less left, or a gap of 32 px or more: the inner shape keeps
  // its own corner.
  assert.equal(nestedRadius(16, 14), undefined);
  assert.equal(nestedRadius(48, 32), undefined);
});

test('breakpoints and layers rise', () => {
  assert.ok(rising(Object.values(BREAKPOINTS)));
  assert.ok(rising(Object.values(LAYERS)));
});
