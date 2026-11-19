// Checks the built preview before it is served (part of `pnpm
// design:preview:build`), as the console's build is checked: the policy
// comes before anything loads, nothing is inline for it to refuse, no
// source maps, and nothing comes from another site. Also that the theme's
// first step is a plain blocking script that runs before the styles.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('dist/', import.meta.url));
const problems: string[] = [];

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const at = (pattern: RegExp): number => html.search(pattern);
const policyAt = at(/<meta http-equiv="Content-Security-Policy"/);
const firstLoad = Math.min(
  ...[/<script/, /<link/, /<style/].map(at).filter((index) => index >= 0),
);
if (policyAt < 0) {
  problems.push('index.html has no Content Security Policy');
} else if (policyAt > firstLoad) {
  problems.push('the policy comes after something it should cover');
}
const policy =
  /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ??
  '';
for (const loose of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'"]) {
  if (policy.includes(loose)) {
    problems.push(`the policy allows ${loose}`);
  }
}
if (/(^|\s)\*(\s|;|$)|data:|https?:/.test(policy)) {
  problems.push('the policy lets in another site or a data: address');
}
for (const needed of [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
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

// The theme's first step: a classic script (a module would wait for the
// page), before the styles, so a dark choice never shows light first.
const themeInit =
  /<script src="(\/assets\/theme-init-[0-9a-f]{8}\.js)"><\/script>/.exec(html);
const stylesAt = at(/<link rel="stylesheet"/);
if (!themeInit) {
  problems.push("the theme's first step is missing, or not a plain script");
} else {
  if (stylesAt >= 0 && themeInit.index > stylesAt) {
    problems.push("the theme's first step comes after the styles");
  }
  const code = readFileSync(join(dist, themeInit[1] ?? ''), 'utf8');
  if (/^\s*(import|export)\b/m.test(code)) {
    problems.push("the theme's first step imports or exports");
  }
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
for (const file of files(dist)) {
  if (file.endsWith('.map')) {
    problems.push(`source map published: ${file}`);
    continue;
  }
  if (!/\.(js|css|html)$/.test(file)) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  if (text.includes('sourceMappingURL=')) {
    problems.push(`points to a source map: ${file}`);
  }
  if (file.endsWith('.css') && /url\(\s*['"]?(data:|https?:|\/\/)/.test(text)) {
    problems.push(`loads from another site or a data: address: ${file}`);
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(text)) {
    problems.push(`asks Google for fonts: ${file}`);
  }
}

if (problems.length > 0) {
  console.error(
    `The built preview is not safe to serve:\n- ${problems.join('\n- ')}`,
  );
  process.exit(1);
}
console.log(
  'Built preview checked: policy first, theme before styles, nothing inline, no source maps, nothing from another site.',
);
