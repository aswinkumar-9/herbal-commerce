// The theme switch's first step (@herbal/design/theme-init) must run before
// the page is drawn, so a page chosen dark never flashes light (ADR 0036).
// That takes a classic script in <head>: a module script waits for the
// page. It is built on its own, as one small piece of code with nothing
// imported, and `virtual:herbal-theme-init` gives that code as text. The
// page's server writes it inline at the top of <head>, under the page's
// nonce (app/entry.server.tsx): no file to fetch before the first paint
// (part 14B; it was a file of its own before, as in the console).
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { Plugin } from 'vite';

const MODULE = 'virtual:herbal-theme-init';
const RESOLVED = `\0${MODULE}`;

export function themeInit(): Plugin {
  const entry = fileURLToPath(import.meta.resolve('@herbal/design/theme-init'));
  let code: Promise<string> | undefined;
  const bundle = (): Promise<string> =>
    (code ??= build({
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ['iife'], name: 'herbalThemeInit' },
      },
    }).then((result) => {
      const output = Array.isArray(result) ? result[0] : result;
      if (!output || !('output' in output)) {
        throw new Error('theme-init: no output');
      }
      const chunk = output.output[0];
      if (/^\s*(import|export)\b/m.test(chunk.code)) {
        throw new Error('theme-init must stand alone, as a classic script');
      }
      // Written inside <script>: nothing in it may end the element early.
      if (/<\/script/i.test(chunk.code)) {
        throw new Error('theme-init must not contain "</script"');
      }
      return chunk.code.trim();
    }));

  return {
    name: 'herbal-theme-init',
    resolveId(id) {
      return id === MODULE ? RESOLVED : undefined;
    },
    async load(id) {
      return id === RESOLVED
        ? `export default ${JSON.stringify(await bundle())};`
        : undefined;
    },
  };
}
