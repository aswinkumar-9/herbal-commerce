// Starts the customer website (ADR 0039).
// - `pnpm web:dev`: on a laptop, with Vite, so a change shows at once.
// - `pnpm web:start`: the built website (`pnpm web:build` first), as it runs
//   in production, under its full security policy.
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServerBuild } from 'react-router';
import type { RequestHandler } from 'express';

const production = process.argv.includes('--production');
// Set before React and Express load, so both run as they do for customers.
process.env.NODE_ENV = production ? 'production' : 'development';

// This folder, as Windows really spells it. A terminal may start in "c:\"
// where the disk says "C:\", and Node would then load React twice, once
// under each spelling, and fail on every page.
const here = realpathSync.native(dirname(fileURLToPath(import.meta.url)));
process.chdir(here);

const { loadConfig } = await import('./app/config.server.ts');
const { createWebsite } = await import('./server/app.ts');
const config = loadConfig(process.env);

let website;
if (production) {
  const build = (await import(
    pathToFileURL(join(here, 'build', 'server', 'index.js')).href
  )) as ServerBuild;
  website = createWebsite({
    config,
    build,
    clientDir: join(here, 'build', 'client'),
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: here,
    server: { middlewareMode: true },
    appType: 'custom',
  });
  website = createWebsite({
    config,
    build: () =>
      vite.ssrLoadModule(
        'virtual:react-router/server-build',
      ) as Promise<ServerBuild>,
    devMiddleware: vite.middlewares as unknown as RequestHandler,
  });
}

const server = website.listen(config.port, config.host, () => {
  console.log(
    `The website is at ${config.origin} (${production ? 'built' : 'development'})`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
