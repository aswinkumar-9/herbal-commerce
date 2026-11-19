import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  THEME_KEY,
  applyThemeChoice,
  readThemeChoice,
  saveThemeChoice,
} from '../src/theme.ts';

function memory(start: Record<string, string> = {}) {
  const items = new Map(Object.entries(start));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

test('follows the device until a customer chooses', () => {
  assert.equal(readThemeChoice(memory()), 'system');
  assert.equal(readThemeChoice(undefined), 'system');
  assert.equal(readThemeChoice(memory({ [THEME_KEY]: 'dark' })), 'dark');
  assert.equal(readThemeChoice(memory({ [THEME_KEY]: 'light' })), 'light');
});

test('anything else stored is ignored, and blocked storage is no problem', () => {
  for (const value of ['Dark', 'blue', '', '"><script>', 'system ']) {
    assert.equal(readThemeChoice(memory({ [THEME_KEY]: value })), 'system');
  }
  assert.equal(readThemeChoice(broken), 'system');
  assert.doesNotThrow(() => saveThemeChoice(broken, 'dark'));
  assert.doesNotThrow(() => saveThemeChoice(broken, 'system'));
});

test('keeps a choice, and forgets it to follow the device again', () => {
  const storage = memory();
  saveThemeChoice(storage, 'dark');
  assert.equal(storage.items.get(THEME_KEY), 'dark');
  saveThemeChoice(storage, 'light');
  assert.equal(storage.items.get(THEME_KEY), 'light');
  saveThemeChoice(storage, 'system');
  assert.equal(storage.items.has(THEME_KEY), false);
});

test('shows the choice on the page, or nothing to follow the device', () => {
  const root = { dataset: {} as DOMStringMap };
  applyThemeChoice(root, 'dark');
  assert.equal(root.dataset['theme'], 'dark');
  applyThemeChoice(root, 'light');
  assert.equal(root.dataset['theme'], 'light');
  applyThemeChoice(root, 'system');
  assert.equal('theme' in root.dataset, false);
});
