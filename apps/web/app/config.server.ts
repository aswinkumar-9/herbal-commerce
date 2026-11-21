// The website server's settings (ADR 0039), from its environment. Every one
// has a default that suits a laptop, so `pnpm web:dev` needs none. The
// server checks them once as it starts, and refuses to start on a bad one.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

// A plain http or https address, with no query, fragment or odd character,
// so it can never change the security policy it is written into.
const PLAIN_ADDRESS =
  /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;

const address = (name: string) =>
  z
    .string()
    .trim()
    .regex(PLAIN_ADDRESS, `${name} must be a plain http or https address`)
    .transform((value) => value.replace(/\/+$/, ''));

const schema = z.object({
  NODE_ENV: z.string().optional(),
  // Where the website listens. On a laptop, this computer only.
  WEB_HOST: z.string().trim().min(1).default('localhost'),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // The website's own address, as customers reach it: for the links in
  // link previews and for search engines. The API's WEB_BASE_URL.
  WEB_ORIGIN: address('WEB_ORIGIN').default('http://localhost:3001'),
  // The API, as the website server reaches it.
  WEB_API_URL: address('WEB_API_URL').default('http://127.0.0.1:3000'),
  // Where the product photos come from: the API's MEDIA_BASE_URL.
  WEB_MEDIA_BASE_URL: address('WEB_MEDIA_BASE_URL').default(
    'http://127.0.0.1:3000/media',
  ),
  // Proxies in front of the website allowed to report the customer's IP,
  // comma separated, as for the API's TRUST_PROXY. Empty: none.
  WEB_TRUST_PROXY: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  // Whether search engines may list the pages: only the live shop says on.
  WEB_INDEXING: z.enum(['on', 'off']).default('off'),
  // The key that seals a customer's sign-in cookie (ADR 0041): at least 32
  // random characters, kept secret. Needed by a built website; on a laptop
  // without it, a random one is made, so sign-ins end when the server stops.
  WEB_SESSION_SECRET: z
    .string()
    .min(32, 'WEB_SESSION_SECRET must have at least 32 characters')
    .max(512)
    .optional(),
});

export type WebConfig = {
  production: boolean;
  host: string;
  port: number;
  origin: string;
  apiUrl: string;
  mediaBaseUrl: string;
  trustProxy: string[];
  indexing: boolean;
  sessionSecret: string;
};

export function loadConfig(env: Record<string, string | undefined>): WebConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(
      `The website's settings are wrong:\n- ${problems.join('\n- ')}`,
    );
  }
  const values = parsed.data;
  const config: WebConfig = {
    production: values.NODE_ENV === 'production',
    host: values.WEB_HOST,
    port: values.WEB_PORT,
    origin: values.WEB_ORIGIN,
    apiUrl: values.WEB_API_URL,
    mediaBaseUrl: values.WEB_MEDIA_BASE_URL,
    trustProxy: values.WEB_TRUST_PROXY,
    indexing: values.WEB_INDEXING === 'on',
    sessionSecret: values.WEB_SESSION_SECRET ?? laptopSecret(),
  };
  // A built website uses https, except on this computer, where the built
  // website is checked before it ships.
  if (config.production) {
    const problems = [
      ['WEB_ORIGIN', config.origin],
      ['WEB_MEDIA_BASE_URL', config.mediaBaseUrl],
    ]
      .filter(([, value]) => !isHttpsOrThisComputer(value ?? ''))
      .map(([name]) => `${name}: must use https in production`);
    if (!values.WEB_SESSION_SECRET) {
      problems.push('WEB_SESSION_SECRET: must be set in production');
    }
    if (problems.length > 0) {
      throw new Error(
        `The website's settings are wrong:\n- ${problems.join('\n- ')}`,
      );
    }
  }
  return config;
}

// A laptop's own key, made once for the server's life: kept across Vite's
// reloads of this file, so a code change doesn't sign everyone out.
const LAPTOP_SECRET = Symbol.for('herbal.web.laptopSessionSecret');
function laptopSecret(): string {
  const held = globalThis as { [LAPTOP_SECRET]?: string };
  held[LAPTOP_SECRET] ??= randomBytes(32).toString('base64url');
  return held[LAPTOP_SECRET];
}

const THIS_COMPUTER = new Set(['localhost', '127.0.0.1']);

function isHttpsOrThisComputer(value: string): boolean {
  const url = new URL(value);
  return url.protocol === 'https:' || THIS_COMPUTER.has(url.hostname);
}

let current: WebConfig | undefined;

// The settings, read once.
export function getConfig(): WebConfig {
  current ??= loadConfig(process.env);
  return current;
}
