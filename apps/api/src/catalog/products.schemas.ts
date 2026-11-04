import { z } from 'zod';
import { ProductType } from '../generated/prisma/enums';
import { productIssues } from './product-rules';
import { slugSchema as slug, slugify } from './slug';

const categoryId = z.uuid('Choose a category by its ID');
const name = z.string().trim().min(1, 'Name is required').max(100);
// Optional text: empty, or null in a change, means none.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);
const type = z
  .enum(ProductType, 'Choose AYURVEDIC_MEDICINE, FOOD_OR_SUPPLEMENT or COSMETIC')
  .nullable();
// As printed, with spaces dropped and letters made capitals, so a licence
// has one form: " 25d / 123 / 2015 " is stored as "25D/123/2015".
const licenceNumber = z
  .string()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .max(50)
      .regex(
        /^([A-Z0-9][A-Z0-9/.-]*)?$/,
        'A licence number has letters, digits, "/", "." and "-"',
      ),
  )
  .nullable()
  .transform((value) => value || null);
const countryOfOrigin = z
  .string()
  .trim()
  .min(2, 'Enter the country of origin')
  .max(60);
// Customers see lower numbers first, within the product's category.
const position = z.number().int().min(0).max(9999);

// Everything but the category, the name and the slug. All optional: a
// product may be saved as a draft and completed later.
const details = {
  summary: optionalText(160).optional(),
  description: optionalText(5000).optional(),
  ingredients: optionalText(2000).optional(),
  usage: optionalText(2000).optional(),
  type: type.optional(),
  licenceNumber: licenceNumber.optional(),
  manufacturerName: optionalText(200).optional(),
  manufacturerAddress: optionalText(500).optional(),
  countryOfOrigin: countryOfOrigin.optional(),
  isActive: z.boolean().optional(),
  position: position.optional(),
};

// A new product. The slug is made from the name, unless one is given. It
// starts as a hidden draft unless asked; a live one needs its licence and
// maker details and its ingredients (ADR 0021).
export const productSchema = z
  .object({ categoryId, name, slug: slug.optional(), ...details })
  .transform(({ slug: given, ...input }) => ({
    ...input,
    slug: given ?? slugify(input.name),
  }))
  .superRefine((input, context) => {
    if (input.slug.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'The name has no Latin letters or digits: give a slug',
      });
    }
    const issues = productIssues({
      isActive: input.isActive ?? false,
      type: input.type ?? null,
      licenceNumber: input.licenceNumber ?? null,
      manufacturerName: input.manufacturerName ?? null,
      manufacturerAddress: input.manufacturerAddress ?? null,
      ingredients: input.ingredients ?? null,
    });
    for (const issue of issues) {
      context.addIssue({
        code: 'custom',
        path: [issue.field],
        message: issue.message,
      });
    }
  });
export type ProductInput = z.infer<typeof productSchema>;

// A change to a product: only the fields that change. Renaming keeps the
// slug. Whether the product may go live is checked against the product as
// it will be after the change, so that happens when it is saved.
export const productUpdateSchema = z
  .object({
    categoryId: categoryId.optional(),
    name: name.optional(),
    slug: slug.optional(),
    ...details,
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Nothing to change',
  );
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

// What staff may ask of the product list. Query values arrive as text, so
// the number and the yes or no are converted. Unknown parameters are dropped.
export const productListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  isActive: z
    .enum(['true', 'false'], 'Use true or false')
    .transform((value) => value === 'true')
    .optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
