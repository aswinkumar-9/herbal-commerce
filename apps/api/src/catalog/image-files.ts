import type { Prisma } from '../generated/prisma/client';

// The order of a product's images, for staff and in the shop alike: by
// position, then the oldest first. The first is the main photo (ADR 0023).
export const IMAGE_ORDER = [
  { position: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductImageOrderByWithRelationInput[];

// The names of an image's two files in the media storage, from its key.
export function imageFileNames(fileKey: string): {
  large: string;
  small: string;
} {
  return {
    large: `products/${fileKey}-large.webp`,
    small: `products/${fileKey}-small.webp`,
  };
}
