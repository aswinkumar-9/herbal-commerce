/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import {
  DEFAULT_MEDIA_BASE_URL,
  contentSecurityPolicy,
  securityHeaders,
} from './src/security-headers.ts';

// The API on a laptop. It listens on 127.0.0.1 only (ADR 0008).
const API = 'http://127.0.0.1:3000';

// The shop's images, as the API links them (its MEDIA_BASE_URL). A build for
// another place sets ADMIN_MEDIA_BASE_URL.
const MEDIA_BASE_URL =
  process.env.ADMIN_MEDIA_BASE_URL ?? DEFAULT_MEDIA_BASE_URL;

// The built page carries its own Content Security Policy, so the policy
// travels with the files wherever they are served (ADR 0031).
function pagePolicy(): Plugin {
  const slot = '<!-- content-security-policy -->';
  return {
    name: 'herbal-page-policy',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(slot)) {
        throw new Error(`index.html has lost its ${slot} slot`);
      }
      const policy = contentSecurityPolicy(MEDIA_BASE_URL, { inPage: true });
      return html.replace(
        slot,
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

// The admin console (ADR 0031): a single-page app. On a laptop, Vite serves
// it at http://localhost:5173 (ADMIN_ORIGIN in .env) and passes /v1 and
// /media on to the API, so the console and the API share one origin: no
// CORS, and the staff cookie stays SameSite=Strict.
export default defineConfig({
  plugins: [react(), tailwindcss(), pagePolicy()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': API,
      '/media': API,
    },
    // No policy here: hot reload runs inline scripts. `pnpm admin:preview`
    // serves the built console with it.
    headers: securityHeaders(MEDIA_BASE_URL, { withPolicy: false }),
  },
  preview: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': API,
      '/media': API,
    },
    headers: securityHeaders(MEDIA_BASE_URL),
  },
  build: {
    // No public source maps (docs/security.md).
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Libraries apart from the console's own code, so a release of the
        // console leaves them cached.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: 'motion',
              test: /[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/,
            },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
