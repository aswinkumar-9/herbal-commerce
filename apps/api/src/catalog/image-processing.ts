import sharp from 'sharp';
import { validationFailed } from './validation-failed';

// The image library keeps recent images in memory, which helps a server
// that resizes the same files again and again. Every upload here is new.
sharp.cache(false);

// The image types staff may upload, by Content-Type (ADR 0023). Only these
// ever reach the image library: it can read many more, SVG among them, and
// each one is more code that could have a flaw.
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

// One upload is at most 10 MB: enough for a phone photo.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// At most 50 megapixels, read from the file's header before anything is
// decoded: a small file can claim to be a huge image (a "decompression
// bomb") and would fill the memory.
export const MAX_IMAGE_PIXELS = 50_000_000;
// Each side at least this long.
export const MIN_IMAGE_SIDE = 400;
// The longest side of the two files kept for each image.
export const LARGE_SIDE = 1600;
export const SMALL_SIDE = 400;

const NAMES: Record<ImageType, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};
const UNREADABLE = 'The image could not be read. It may be damaged.';

// What a file really is, from its first bytes, whatever its name or its
// Content-Type say. Null for anything else.
export function detectImageType(file: Buffer): ImageType | null {
  if (startsWith(file, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(file, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (
    file.toString('latin1', 0, 4) === 'RIFF' &&
    file.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface ProcessedImage {
  // Two WebP files, a large one and a small one for list pages.
  large: Buffer;
  small: Buffer;
  // The large file's size in pixels.
  width: number;
  height: number;
}

// Checks an uploaded image, then makes the two files the shop shows: WebP,
// upright, at most 1600 and 400 pixels on the longest side, never enlarged.
// Only the pixels are kept, so nothing hidden in the upload survives, such
// as the GPS location in a phone photo. A refusal answers 400 on "image".
export async function processImage(
  file: Buffer,
  declared: ImageType,
): Promise<ProcessedImage> {
  if (detectImageType(file) !== declared) {
    throw refused(`The file is not a ${NAMES[declared]} image`);
  }
  const { width, height } = await headerSize(file);
  if (width * height > MAX_IMAGE_PIXELS) {
    throw refused(
      `The image may have at most ${MAX_IMAGE_PIXELS / 1_000_000} megapixels`,
    );
  }
  if (Math.min(width, height) < MIN_IMAGE_SIDE) {
    throw refused(
      `The image needs at least ${MIN_IMAGE_SIDE} pixels on each side`,
    );
  }
  // One after the other, so one upload never holds two decoded images.
  const large = await webp(file, LARGE_SIDE);
  const small = await webp(file, SMALL_SIDE);
  return {
    large: large.data,
    small: small.data,
    width: large.info.width,
    height: large.info.height,
  };
}

function startsWith(file: Buffer, bytes: number[]): boolean {
  return file.subarray(0, bytes.length).equals(Buffer.from(bytes));
}

function refused(message: string) {
  return validationFailed([{ field: 'image', message }]);
}

// The size from the file's header alone. Whether the photo is stored on
// its side changes neither its shorter side nor its number of pixels.
async function headerSize(
  file: Buffer,
): Promise<{ width: number; height: number }> {
  try {
    const { width, height } = await sharp(file).metadata();
    return { width, height };
  } catch {
    throw refused(UNREADABLE);
  }
}

async function webp(file: Buffer, side: number) {
  try {
    return await sharp(file, {
      // A file cut short is refused, not filled up with grey.
      failOn: 'truncated',
      limitInputPixels: MAX_IMAGE_PIXELS,
      autoOrient: true,
    })
      .resize({
        width: side,
        height: side,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw refused(UNREADABLE);
  }
}
