// The shop's catalog, as the API's public endpoints give it
// (docs/api-specification.md, "Categories" and "Products"). Answers are
// checked against these before a page uses them.
import { z } from 'zod';
import { apiGet } from './api.server.ts';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const categorySchema = z.object({
  name: z.string().min(1),
  slug,
  description: z.string().nullable(),
});
export type Category = z.infer<typeof categorySchema>;

const categoriesSchema = z.object({ categories: z.array(categorySchema) });

// The categories customers see, in the order staff chose.
export async function listCategories(request: Request): Promise<Category[]> {
  const { categories } = await apiGet(request, 'categories', categoriesSchema);
  return categories;
}
