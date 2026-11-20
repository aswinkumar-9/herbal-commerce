// The theme switch's first step (@herbal/design/theme-init) must run before
// the page is drawn, so a page chosen dark never flashes light (ADR 0036).
// That takes a classic, blocking <script src> in <head>: a module script
// waits for the page. So it is built on its own, as one small file with
// nothing imported. Pages name it through `virtual:herbal-theme-init`.
import { createHash } from 'node:crypto';
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
      return chunk.code;
    }));

  // On a laptop it has a plain name; a build names it by its content, so a
  // changed file is never served from an old cache.
  let file = '/theme-init.js';
  let building = false;
  return {
    name: 'herbal-theme-init',
    configResolved(config) {
      building = config.command === 'build';
    },
    configureServer(server) {
      server.middlewares.use(file, (_request, response, next) => {
        bundle().then((source) => {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(source);
        }, next);
      });
    },
    async buildStart() {
      if (building) {
        const hash = createHash('sha256').update(await bundle());
        file = `/assets/theme-init-${hash.digest('hex').slice(0, 8)}.js`;
      }
    },
    resolveId(id) {
      return id === MODULE ? RESOLVED : undefined;
    },
    load(id) {
      return id === RESOLVED
        ? `export default ${JSON.stringify(file)};`
        : undefined;
    },
    // Written once, with the browser's files.
    async generateBundle() {
      if (this.environment.name === 'client') {
        this.emitFile({
          type: 'asset',
          fileName: file.slice(1),
          source: await bundle(),
        });
      }
    },
  };
}
