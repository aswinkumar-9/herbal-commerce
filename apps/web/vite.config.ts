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
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./app/test/setup.ts'],
    restoreMocks: true,
    include: ['app/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
});
