/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API on a laptop. It listens on 127.0.0.1 only (ADR 0008).
const API = 'http://127.0.0.1:3000';

// The admin console (ADR 0031): a single-page app. On a laptop, Vite serves
// it at http://localhost:5173 (ADMIN_ORIGIN in .env) and passes /v1 and
// /media on to the API, so the console and the API share one origin: no
// CORS, and the staff cookie stays SameSite=Strict.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': API,
      '/media': API,
    },
  },
  preview: { host: 'localhost', port: 5173, strictPort: true },
  build: {
    // No public source maps (docs/security.md).
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
