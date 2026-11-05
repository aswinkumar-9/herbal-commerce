import { z } from 'zod';

// Describes the photo for people who cannot see it, such as "The back
// label, with the ingredients". Empty, or null, means none: the shop then
// uses the product's name.
const altText = z
  .string()
  .trim()
  .max(150)
  .nullable()
  .transform((value) => value || null);
// The order on the product's page. The first image is the main photo.
const position = z.number().int().min(0).max(9999);

// A change to an image: its description or its place. The image itself
// never changes; a new photo is a new upload (ADR 0023).
export const imageUpdateSchema = z
  .object({
    altText: altText.optional(),
    position: position.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Nothing to change',
  );
export type ImageUpdateInput = z.infer<typeof imageUpdateSchema>;
