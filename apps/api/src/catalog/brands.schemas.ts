import { z } from 'zod';
import { slugSchema as slug, slugify } from './slug';

const name = z.string().trim().min(1, 'Name is required').max(60);

// A new brand (part 15A). The slug is made from the name, unless one is
// given: a name without Latin letters needs one.
export const brandSchema = z
  .object({ name, slug: slug.optional() })
  .transform(({ slug: given, ...input }) => ({
    ...input,
    slug: given ?? slugify(input.name),
  }))
  .refine((input) => input.slug.length > 0, {
    message: 'The name has no Latin letters or digits: give a slug',
    path: ['slug'],
  });
export type BrandInput = z.infer<typeof brandSchema>;

// A change to a brand: only the fields that change. Renaming keeps the
// slug, so links to the shop filtered by the brand keep working; send a
// slug to change it.
export const brandUpdateSchema = z
  .object({ name: name.optional(), slug: slug.optional() })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Nothing to change',
  );
export type BrandUpdateInput = z.infer<typeof brandUpdateSchema>;
