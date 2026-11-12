import { z } from 'zod';
import { slugSchema as slug, slugify } from './slug';

const name = z.string().trim().min(1, 'Name is required').max(60);

// An empty description means none.
const description = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((value) => value || null);
// Customers see lower numbers first.
const position = z.number().int().min(0).max(9999);

// A new category. The slug is made from the name, unless one is given: a
// name without Latin letters needs one. It starts inactive unless asked.
export const categorySchema = z
  .object({
    name,
    slug: slug.optional(),
    description: description.optional(),
    position: position.optional(),
    isActive: z.boolean().optional(),
  })
  .transform(({ slug: given, ...input }) => ({
    ...input,
    slug: given ?? slugify(input.name),
  }))
  .refine((input) => input.slug.length > 0, {
    message: 'The name has no Latin letters or digits: give a slug',
    path: ['slug'],
  });
export type CategoryInput = z.infer<typeof categorySchema>;

// A change to a category: only the fields that change. Renaming keeps the
// slug, so links to the category keep working; send a slug to change it.
export const categoryUpdateSchema = z
  .object({
    name: name.optional(),
    slug: slug.optional(),
    description: description.optional(),
    position: position.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Nothing to change',
  );
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// A new order for the categories customers see: every category, hidden ones
// too, each once, first to last (ADR 0031).
export const categoryOrderSchema = z.object({
  ids: z
    .array(z.uuid('Each category by its ID'))
    .min(1, 'List the categories')
    .max(500, 'At most 500 categories')
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'List each category once',
    ),
});
export type CategoryOrderInput = z.infer<typeof categoryOrderSchema>;
