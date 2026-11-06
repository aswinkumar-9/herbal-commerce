import type { PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../generated/prisma/client';
import type { MediaStorage } from '../media/media-storage';

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

// Deletes an image's two files. A failure is logged, never thrown: a file
// left behind only takes space, and whatever led here matters more.
export async function removeImageFiles(
  media: MediaStorage,
  logger: PinoLogger,
  fileKey: string,
): Promise<void> {
  const names = imageFileNames(fileKey);
  try {
    await media.remove(names.large);
    await media.remove(names.small);
  } catch (error) {
    logger.warn({ err: error, fileKey }, 'Image files not deleted');
  }
}
