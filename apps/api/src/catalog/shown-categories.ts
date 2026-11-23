import type { Prisma } from '../generated/prisma/client';

// A category customers see (part 15A): an active one, and when it is a
// subcategory, inside an active top category. Hiding a top category hides
// everything in it, its subcategories and their products too.
export const SHOWN_CATEGORY = {
  isActive: true,
  OR: [{ parentId: null }, { parent: { isActive: true } }],
} satisfies Prisma.CategoryWhereInput;

// What to read of a category to tell whether customers see it.
export const SHOWN_FIELDS = {
  isActive: true,
  parent: { select: { isActive: true } },
} satisfies Prisma.CategorySelect;

export function isShown(category: {
  isActive: boolean;
  parent: { isActive: boolean } | null;
}): boolean {
  return category.isActive && (category.parent?.isActive ?? true);
}
