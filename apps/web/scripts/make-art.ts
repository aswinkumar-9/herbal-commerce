// Makes the website's copies of the owner's pictures (part 14A): each as
// WebP in two widths, for phones and for wide screens, and one JPEG for
// link previews (WhatsApp and others want JPEG, 1200 × 630). Their details
// (camera, tool, location) are left out. The originals stay outside the
// repository; run this again when they change:
//   pnpm --filter web art "C:\dev\webApplication+images"
// It borrows the API's image library (sharp), so nothing more is installed.
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The part of sharp used here (its own types live with the API).
interface Picture {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(options: Record<string, unknown>): Picture;
  webp(options: Record<string, unknown>): Picture;
  jpeg(options: Record<string, unknown>): Picture;
  toFile(path: string): Promise<unknown>;
}
type Sharp = (input: string) => Picture;
const sharp = createRequire(new URL('../../api/package.json', import.meta.url))(
  'sharp',
) as Sharp;

const source = process.argv[2] ?? 'C:/dev/webApplication+images';
const out = fileURLToPath(new URL('../app/art/', import.meta.url));
mkdirSync(out, { recursive: true });

// Each picture: its file from the owner, the name it has here, and the
// widths made of it (the widest is its own width at most).
const PICTURES = [
  {
    file: 'Sunlit Herbal Apothecary Still Life.png',
    name: 'hero-wide',
    widths: [960, 1672],
  },
  {
    file: 'Golden Herbal Botanical Elixir.png',
    name: 'hero-tall',
    widths: [640, 941],
  },
  {
    file: 'Golden-Hour Saffron Tea Retreat.png',
    name: 'fields',
    widths: [960, 1672],
  },
  {
    file: 'Mystical Tree of Life in Golden Light.png',
    name: 'roots',
    widths: [640, 1254],
  },
] as const;

const kb = (path: string): string =>
  `${Math.round(statSync(path).size / 1024)} kB`;

for (const picture of PICTURES) {
  const input = join(source, picture.file);
  const { width = 0, height = 0 } = await sharp(input).metadata();
  for (const wanted of picture.widths) {
    const size = Math.min(wanted, width);
    const file = join(out, `${picture.name}-${size}.webp`);
    await sharp(input)
      .resize({ width: size, withoutEnlargement: true })
      .webp({ quality: 78, effort: 6 })
      .toFile(file);
    console.log(
      `${picture.name}-${size}.webp  ${kb(file)}  (${width}×${height})`,
    );
  }
}

// The link preview: the wide picture, cut to 1200 × 630 around its middle.
const preview = join(out, 'preview-home.jpg');
await sharp(join(source, PICTURES[0].file))
  .resize({ width: 1200, height: 630, fit: 'cover', position: 'centre' })
  .jpeg({ quality: 80, mozjpeg: true })
  .toFile(preview);
console.log(`preview-home.jpg  ${kb(preview)}`);
