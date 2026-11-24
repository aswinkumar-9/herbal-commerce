import { describe, expect, it } from 'vitest';
import type { Category } from './catalog-api';
import {
  categoryLabel,
  inLevel,
  isShown,
  labelOf,
  nextPositionIn,
  parentOf,
  visibilityNote,
} from './category-tree';

const at = '2026-11-01T09:00:00.000Z';
function category(
  id: string,
  name: string,
  more: Partial<Category> = {},
): Category {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(' ', '-'),
    description: null,
    isActive: true,
    position: 0,
    parentId: null,
    createdAt: at,
    updatedAt: at,
    ...more,
  };
}

// As the API lists them: each top category followed by its own.
const HAIR = category('h', 'Hair Care');
const OILS = category('o', 'Hair Oils', { parentId: 'h', position: 4 });
const MASKS = category('m', 'Hair Masks', { parentId: 'h', position: 7 });
const SKIN = category('s', 'Skin Care', { isActive: false, position: 1 });
const SOAPS = category('p', 'Herbal Soaps', { parentId: 's' });
const ALL = [HAIR, OILS, MASKS, SKIN, SOAPS];

describe('the categories as a tree (part 15A)', () => {
  it('keeps the order of each level', () => {
    expect(inLevel(ALL, null)).toEqual([HAIR, SKIN]);
    expect(inLevel(ALL, 'h')).toEqual([OILS, MASKS]);
    expect(inLevel(ALL, 'o')).toEqual([]);
  });

  it('finds the top category a subcategory sits in', () => {
    expect(parentOf(ALL, OILS)).toBe(HAIR);
    expect(parentOf(ALL, HAIR)).toBeUndefined();
  });

  it('counts a subcategory as hidden while its top category is', () => {
    expect(isShown(ALL, HAIR)).toBe(true);
    expect(isShown(ALL, OILS)).toBe(true);
    expect(isShown(ALL, SKIN)).toBe(false);
    expect(isShown(ALL, SOAPS)).toBe(false);
    expect(isShown(ALL, { ...OILS, isActive: false })).toBe(false);
  });

  it('names a subcategory with the category it sits in', () => {
    expect(categoryLabel(ALL, HAIR)).toBe('Hair Care');
    expect(categoryLabel(ALL, OILS)).toBe('Hair Care › Hair Oils');
    expect(labelOf(ALL, 'p')).toBe('Skin Care › Herbal Soaps');
    expect(labelOf(ALL, 'gone')).toBeUndefined();
  });

  it('puts a new one after the last of its level, never past the highest place', () => {
    expect(nextPositionIn(ALL, null)).toBe(2);
    expect(nextPositionIn(ALL, 'h')).toBe(8);
    expect(nextPositionIn(ALL, 'o')).toBe(0);
    expect(nextPositionIn([HAIR, { ...OILS, position: 9999 }], 'h')).toBe(9999);
  });

  it('says what customers now see', () => {
    expect(visibilityNote(ALL, HAIR)).toBe(
      'Hair Care is now shown to customers',
    );
    expect(visibilityNote(ALL, { ...HAIR, isActive: false })).toBe(
      'Hair Care and its subcategories are now hidden from customers',
    );
    expect(visibilityNote(ALL, { ...OILS, isActive: false })).toBe(
      'Hair Oils is now hidden from customers',
    );
    expect(visibilityNote(ALL, OILS)).toBe(
      'Hair Oils is now shown to customers',
    );
    expect(visibilityNote(ALL, SOAPS)).toBe(
      'Herbal Soaps will be shown once Skin Care is shown',
    );
  });
});
