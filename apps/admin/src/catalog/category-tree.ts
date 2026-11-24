import { MAX_POSITION } from './catalog-api';
import type { Category } from './catalog-api';

// Subcategories (part 15A): a category sits inside a top category, or in
// none. Only two levels. The API lists them as the shop shows them: each
// top category followed by its own subcategories, so a filter keeps the
// order.

// The categories of one level, in order: the top ones (null), or the
// subcategories of one top category.
export function inLevel(
  categories: readonly Category[],
  parentId: string | null,
): Category[] {
  return categories.filter((category) => category.parentId === parentId);
}

// The top category a subcategory sits in; undefined for a top category.
export function parentOf(
  categories: readonly Category[],
  category: Category,
): Category | undefined {
  return category.parentId === null
    ? undefined
    : categories.find((other) => other.id === category.parentId);
}

// Whether customers see it: shown, and inside a shown top category.
export function isShown(
  categories: readonly Category[],
  category: Category,
): boolean {
  return (
    category.isActive && (parentOf(categories, category)?.isActive ?? true)
  );
}

// "Hair Care" for a top category, "Hair Care › Hair Oils" for a
// subcategory, so a choice from the list says where it sits.
export function categoryLabel(
  categories: readonly Category[],
  category: Category,
): string {
  const parent = parentOf(categories, category);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

// The same, for the category with this ID, while the list has it.
export function labelOf(
  categories: readonly Category[],
  id: string,
): string | undefined {
  const category = categories.find((other) => other.id === id);
  return category && categoryLabel(categories, category);
}

// Where a category put into a level goes: after its last one.
export function nextPositionIn(
  categories: readonly Category[],
  parentId: string | null,
): number {
  return Math.min(
    MAX_POSITION,
    Math.max(-1, ...inLevel(categories, parentId).map((c) => c.position)) + 1,
  );
}

// What staff are told when a category is shown or hidden: a subcategory
// stays hidden while its top category is, and hiding a top category hides
// its subcategories too.
export function visibilityNote(
  categories: readonly Category[],
  saved: Category,
): string {
  const parent = parentOf(categories, saved);
  if (saved.isActive) {
    return parent && !parent.isActive
      ? `${saved.name} will be shown once ${parent.name} is shown`
      : `${saved.name} is now shown to customers`;
  }
  return inLevel(categories, saved.id).length > 0
    ? `${saved.name} and its subcategories are now hidden from customers`
    : `${saved.name} is now hidden from customers`;
}
