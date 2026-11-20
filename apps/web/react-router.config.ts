import type { Config } from '@react-router/dev/config';

// The customer website (ADR 0039): every page is first made on the server,
// so a shared link and a search engine see the real page, then the browser
// takes over.
export default {
  appDirectory: 'app',
  buildDirectory: 'build',
  ssr: true,
} satisfies Config;
