import { isIP } from 'node:net';
import { z } from 'zod';

// Express's names for groups of private addresses.
const PROXY_RANGE_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

// One TRUST_PROXY entry: a range name, an IP address or a subnet (10.0.0.0/8).
function isProxyEntry(entry: string): boolean {
  if (PROXY_RANGE_NAMES.has(entry)) {
    return true;
  }
  const [address, prefix, ...rest] = entry.split('/');
  const version = isIP(address);
  if (version === 0 || rest.length > 0) {
    return false;
  }
  return (
    prefix === undefined ||
    (/^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128))
  );
}

// A random secret from the generator in .env.example: at least 43 base64url
// characters (256 bits), and not repetitive.
const strongSecret = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{43,}$/,
    'must be at least 43 letters, digits, "-" or "_" (see .env.example)',
  )
  .refine(
    (secret) => new Set(secret).size >= 16,
    'is too repetitive to be random (see .env.example)',
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Proxies allowed to report the client IP (X-Forwarded-For), comma separated.
  // Empty, the default: trust none, so nobody can fake their IP.
  TRUST_PROXY: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    )
    .refine(
      (entries) => entries.every(isProxyEntry),
      'must list proxy addresses or subnets, or "loopback", "linklocal", "uniquelocal" (no hop counts)',
    ),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z
    .string()
    .min(3)
    .default('Herbal Commerce <no-reply@herbal.local>'),
  WEB_BASE_URL: z
    .string()
    .regex(/^https?:\/\//)
    .default('http://localhost:3001'),
  DATABASE_URL: z.string().min(1).startsWith('postgresql://'),
  VALKEY_URL: z.string().min(1).startsWith('redis://'),
  // Signs access tokens. Generate it with the command in .env.example.
  JWT_ACCESS_SECRET: strongSecret,
  // Encrypts staff MFA secrets in the database. A separate key, so replacing
  // the JWT secret never wipes everyone's MFA.
  MFA_ENCRYPTION_KEY: strongSecret,
});

export type Env = z.infer<typeof envSchema>;

// Settings whose .env.example values are placeholders.
const PLACEHOLDER_KEYS = [
  'DATABASE_URL',
  'VALKEY_URL',
  'JWT_ACCESS_SECRET',
  'MFA_ENCRYPTION_KEY',
] as const;

// One secret must never do two jobs.
function sharedSecretProblems(env: Env): string[] {
  return env.MFA_ENCRYPTION_KEY === env.JWT_ACCESS_SECRET
    ? ['MFA_ENCRYPTION_KEY: must not be the same as JWT_ACCESS_SECRET']
    : [];
}

// Fine on a laptop, never in production.
function productionProblems(env: Env): string[] {
  const problems: string[] = [];
  for (const key of PLACEHOLDER_KEYS) {
    if (env[key].includes('change_me')) {
      problems.push(`${key}: still contains the .env.example placeholder`);
    }
  }
  if (!env.WEB_BASE_URL.startsWith('https://')) {
    problems.push('WEB_BASE_URL: must use https in production');
  }
  return problems;
}

function configError(problems: string[]): Error {
  return new Error(`Invalid environment configuration: ${problems.join('; ')}`);
}

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    // Only names and messages are reported, never the values (they may be secrets).
    throw configError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }
  const problems = [
    ...sharedSecretProblems(result.data),
    ...(result.data.NODE_ENV === 'production'
      ? productionProblems(result.data)
      : []),
  ];
  if (problems.length > 0) {
    throw configError(problems);
  }
  return result.data;
}
