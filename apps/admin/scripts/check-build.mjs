// Checks the built console before it can be served (part of `pnpm
// admin:build`): its page carries the Content Security Policy before
// anything loads, it has no inline script or style for that policy to
// refuse, and no source maps were published (ADR 0031).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);
const problems = [];

const html = readFileSync(new URL('index.html', dist), 'utf8');
const policyAt = html.indexOf('<meta http-equiv="Content-Security-Policy"');
const firstLoad = Math.min(
  ...['<script', '<link', '<style']
    .map((tag) => html.indexOf(tag))
    .filter((at) => at >= 0),
);
if (policyAt < 0) {
  problems.push('index.html has no Content Security Policy');
} else if (policyAt > firstLoad) {
  problems.push(
    'the Content Security Policy comes after something it should cover',
  );
}
const policy =
  /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ??
  '';
for (const loose of [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'unsafe-hashes'",
  ' * ',
  'data:',
]) {
  if (policy.includes(loose)) {
    problems.push(`the policy allows ${loose.trim()}`);
  }
}
for (const needed of [
  "default-src 'none'",
  "script-src 'self'",
  "require-trusted-types-for 'script'",
]) {
  if (!policy.includes(needed)) {
    problems.push(`the policy lacks ${needed}`);
  }
}
for (const script of html.match(/<script\b[^>]*>/g) ?? []) {
  if (!/\bsrc=/.test(script)) {
    problems.push(`inline script: ${script}`);
  }
}
if (/<style\b|\sstyle=/.test(html)) {
  problems.push('index.html has inline style');
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
for (const file of files(fileURLToPath(dist))) {
  if (file.endsWith('.map')) {
    problems.push(`source map published: ${file}`);
  } else if (
    file.endsWith('.js') &&
    readFileSync(file, 'utf8').includes('sourceMappingURL=')
  ) {
    problems.push(`points to a source map: ${file}`);
  }
}

if (problems.length > 0) {
  console.error(
    `The built console is not safe to serve:\n- ${problems.join('\n- ')}`,
  );
  process.exit(1);
}
console.log(
  'Built console checked: policy first, nothing inline, no source maps.',
);
