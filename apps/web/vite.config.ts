/// <reference types="vitest/config" />
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { themeInit } from './scripts/theme-init-plugin.ts';

// The customer website (ADR 0039). The website server (server.ts) runs Vite
// inside itself on a laptop, so there is no Vite server port here.
export default defineConfig({
  // React Router's plugin builds the website; the tests load the pages'
  // parts on their own, without it.
  plugins: [
    tailwindcss(),
    ...(process.env['VITEST'] ? [] : [reactRouter()]),
    themeInit(),
  ],
  build: {
    // No public source maps (docs/security.md), and every font and picture
    // its own file, never a data: address the policy would refuse.
    sourcemap: false,
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        // Each page's own code is split off by React Router. The libraries
        // every page needs get files of their own, as in the console, so a
        // release that changes only the website's words or pages leaves
        // them cached. Icons are left out of the groups: each page keeps
        // just the icons it shows.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: 'router',
              test: /[\\/]node_modules[\\/](react-router|@react-router[\\/][^\\/]+)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./app/test/setup.ts'],
    restoreMocks: true,
    include: ['app/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
});
