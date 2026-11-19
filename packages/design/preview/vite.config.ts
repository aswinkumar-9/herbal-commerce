import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { build, defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { contentSecurityPolicy, securityHeaders } from './policy.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const design = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5180;

// The theme switch's first step (src/theme-init.ts) must run before the
// page is drawn, so a page chosen dark never flashes light. That takes a
// classic, blocking <script src> in <head>: a module script waits for the
// page, and the policy forbids inline script. So it is built on its own,
// as one small file with nothing imported, and put in the page's
// <!-- theme-init --> slot.
function themeInit(): Plugin {
  const slot = '<!-- theme-init -->';
  let code: Promise<string> | undefined;
  const bundle = (): Promise<string> =>
    (code ??= build({
      configFile: false,
      root: design,
      publicDir: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: true,
        lib: {
          entry: fileURLToPath(
            new URL('../src/theme-init.ts', import.meta.url),
          ),
          formats: ['iife'],
          name: 'herbalThemeInit',
        },
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
  // On the dev server it has a plain name; a build names it by its content,
  // so a changed file is never served from an old cache.
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
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: file.slice(1),
        source: await bundle(),
      });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes(slot)) {
          throw new Error(`index.html has lost its ${slot} slot`);
        }
        return html.replace(slot, `<script src="${file}"></script>`);
      },
    },
  };
}

// The built page carries its own policy, so it travels with the files.
function pagePolicy(): Plugin {
  const slot = '<!-- content-security-policy -->';
  return {
    name: 'herbal-page-policy',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(slot)) {
        throw new Error(`index.html has lost its ${slot} slot`);
      }
      const policy = contentSecurityPolicy({ inPage: true });
      return html.replace(
        slot,
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

// The shop's look on one page, for the owner to see and approve (ADR 0036):
// `pnpm design:preview` at http://localhost:5180, and
// `pnpm design:preview:build` then `pnpm design:preview:serve` for the built
// page under the full policy.
export default defineConfig({
  root: here,
  publicDir: false,
  plugins: [tailwindcss(), themeInit(), pagePolicy()],
  server: {
    host: 'localhost',
    port: PORT,
    strictPort: true,
    headers: securityHeaders({ withPolicy: false }),
  },
  preview: {
    host: 'localhost',
    port: PORT,
    strictPort: true,
    headers: securityHeaders(),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // No public source maps, and every font and picture its own file, never
    // a data: address the policy would refuse.
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
