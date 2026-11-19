// Writes each look's CSS (css/<look>.css). Run it after changing a look:
// `pnpm design:build`. A test fails while the CSS and the look differ.
import { mkdirSync, writeFileSync } from 'node:fs';
import { LOOKS } from '../src/index.ts';
import { cssFile, cssFor } from './sources.ts';

mkdirSync(new URL('../css/', import.meta.url), { recursive: true });
for (const look of LOOKS) {
  writeFileSync(cssFile(look), cssFor(look));
  console.log(`css/${look.name}.css`);
}
