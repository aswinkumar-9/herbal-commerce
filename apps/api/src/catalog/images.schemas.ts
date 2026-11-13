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
export const MAX_IMAGE_POSITION = 9999;
const position = z.number().int().min(0).max(MAX_IMAGE_POSITION);

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

// A new order for a product's images: every one of them, each once, first
// to last (ADR 0033). The first becomes the main photo. A product has at
// most 6 images (ADR 0023).
export const imageOrderSchema = z.object({
  ids: z
    .array(z.uuid('Each image by its ID'))
    .min(1, 'List the images')
    .max(6, 'At most 6 images')
    .refine((ids) => new Set(ids).size === ids.length, 'List each image once'),
});
export type ImageOrderInput = z.infer<typeof imageOrderSchema>;
