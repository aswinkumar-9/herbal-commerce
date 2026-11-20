// Checks the built website before it can be served (part of `pnpm
// web:build`, ADR 0039). It starts the built website on a spare port, with
// the API out of reach on purpose, and reads two pages as a browser would:
// "not found" (404) and the home page, which then says the shop is taking
// a break (503). Each must carry its own policy with a fresh nonce, every
// inline script that nonce, and no inline style at all. No source map may
// be published, and no font or picture may hide in a data: address.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServerBuild } from 'react-router';

process.env.NODE_ENV = 'production';
// Port 9 (discard) answers nothing: the API is out of reach.
process.env['WEB_API_URL'] = 'http://127.0.0.1:9';

// This folder as Windows spells it, so React loads once (see server.ts).
const web = realpathSync.native(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const problems: string[] = [];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
for (const file of files(join(web, 'build', 'client'))) {
  if (file.endsWith('.map')) {
    problems.push(`source map published: ${file}`);
  } else if (/\.(js|css)$/.test(file)) {
    const content = readFileSync(file, 'utf8');
    if (content.includes('sourceMappingURL=')) {
      problems.push(`points to a source map: ${file}`);
    }
    if (/url\(\s*['"]?data:/.test(content)) {
      problems.push(`a data: address the policy would refuse: ${file}`);
    }
  }
}

// The API being out of reach is logged, as it should be; kept quiet here
// unless the check fails.
const logged: unknown[][] = [];
console.error = (...args: unknown[]) => {
  logged.push(args);
};

const { loadConfig } = await import('../app/config.server.ts');
const { createWebsite } = await import('../server/app.ts');
const build = (await import(
  pathToFileURL(join(web, 'build', 'server', 'index.js')).href
)) as ServerBuild;
const website = createWebsite({
  config: loadConfig(process.env),
  build,
  clientDir: join(web, 'build', 'client'),
});
const server = await new Promise<Server>((resolve) => {
  const listening = website.listen(0, '127.0.0.1', () => resolve(listening));
});
const address = server.address();
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

const nonces = new Set<string>();
async function checkPage(path: string, status: number): Promise<void> {
  const response = await fetch(`${base}${path}`);
  const html = await response.text();
  const where = `${path}:`;
  if (response.status !== status) {
    problems.push(`${where} answered ${response.status}, not ${status}`);
  }
  const policy = response.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
  if (!nonce) {
    problems.push(`${where} has no policy with a nonce`);
    return;
  }
  if (nonces.has(nonce)) {
    problems.push(`${where} reuses a nonce`);
  }
  nonces.add(nonce);
  for (const loose of [
    "'unsafe-inline'",
    "'unsafe-eval'",
    "'unsafe-hashes'",
    'data:',
    ' * ',
  ]) {
    if (policy.includes(loose)) {
      problems.push(`${where} the policy allows ${loose.trim()}`);
    }
  }
  for (const needed of [
    "default-src 'none'",
    "style-src 'self'",
    "require-trusted-types-for 'script'",
    "frame-ancestors 'none'",
  ]) {
    if (!policy.includes(needed)) {
      problems.push(`${where} the policy lacks ${needed}`);
    }
  }
  for (const script of html.match(/<script\b[^>]*>/g) ?? []) {
    if (!/\bsrc=/.test(script) && !script.includes(`nonce="${nonce}"`)) {
      problems.push(
        `${where} an inline script without the page's nonce: ${script}`,
      );
    }
  }
  if (/<style\b|\sstyle=/.test(html)) {
    problems.push(`${where} inline style, which the policy refuses`);
  }
  const themeAt = html.search(
    /<script src="\/assets\/theme-init-[0-9a-f]{8}\.js">/,
  );
  const styleAt = html.indexOf('rel="stylesheet"');
  if (themeAt < 0 || styleAt < 0 || themeAt > styleAt) {
    problems.push(
      `${where} the theme's first step must come before the stylesheet`,
    );
  }
  for (const [name, value] of [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['cache-control', 'private, no-cache'],
  ]) {
    if (response.headers.get(name ?? '') !== value) {
      problems.push(`${where} ${name} is not ${value}`);
    }
  }
  if (response.headers.has('x-powered-by')) {
    problems.push(`${where} says what it runs on (X-Powered-By)`);
  }
}

try {
  await checkPage('/this-page-does-not-exist', 404);
  await checkPage('/', 503);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

if (problems.length > 0) {
  for (const args of logged) {
    process.stderr.write(`${args.map(String).join(' ')}\n`);
  }
  process.stderr.write(
    `The built website is not safe to serve:\n- ${problems.join('\n- ')}\n`,
  );
  process.exit(1);
}
console.log(
  'Built website checked: a policy with a fresh nonce on every page, every inline script carrying it, no inline style, no source maps.',
);
