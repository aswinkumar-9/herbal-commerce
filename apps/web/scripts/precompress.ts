// Brotli and gzip copies of the built files a browser downloads (part 14B,
// after the Lighthouse audit), made once at each one's best level, so the
// server only picks the smallest the browser can read (server/app.ts).
// Pictures and fonts are compressed already and left alone; a copy is kept
// only when it saves something. Part of `pnpm web:build`, after React
// Router's build and before the build check.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const CLIENT = fileURLToPath(new URL('../build/client/', import.meta.url));
const TEXT = /\.(js|css|svg|json|txt|xml|webmanifest)$/;
// Below this, the copy would hardly be smaller than the request around it.
const AT_LEAST = 1024;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let count = 0;
let before = 0;
let after = 0;
for (const file of files(CLIENT)) {
  if (!TEXT.test(file)) {
    continue;
  }
  const plain = readFileSync(file);
  if (plain.length < AT_LEAST) {
    continue;
  }
  const br = brotliCompressSync(plain, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: plain.length,
    },
  });
  const gzip = gzipSync(plain, { level: constants.Z_BEST_COMPRESSION });
  for (const [suffix, copy] of [
    ['br', br],
    ['gz', gzip],
  ] as const) {
    if (copy.length < plain.length * 0.9) {
      writeFileSync(`${file}.${suffix}`, copy);
    }
  }
  count += 1;
  before += plain.length;
  after += br.length;
}
const kb = (bytes: number): string => `${Math.round(bytes / 1024)} kB`;
console.log(
  `Compressed ${count} built files: ${kb(before)} as they are, ${kb(after)} with Brotli.`,
);
