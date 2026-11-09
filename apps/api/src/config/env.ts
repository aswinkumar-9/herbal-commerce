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
  // Where uploaded images are kept (ADR 0023). A relative folder is inside
  // the folder the API runs in, apps/api.
  MEDIA_DIR: z.string().min(1).default('storage/media'),
  // The address the shop links images from: the API itself on a laptop,
  // later a CDN in front of object storage. A final "/" is dropped.
  MEDIA_BASE_URL: z
    .string()
    .regex(/^https?:\/\/[^/]/, 'must be an http or https address')
    .default('http://127.0.0.1:3000/media')
    .transform((url) => url.replace(/\/+$/, '')),
  DATABASE_URL: z.string().min(1).startsWith('postgresql://'),
  VALKEY_URL: z.string().min(1).startsWith('redis://'),
  // Signs access tokens. Generate it with the command in .env.example.
  JWT_ACCESS_SECRET: strongSecret,
  // Encrypts staff MFA secrets in the database. A separate key, so replacing
  // the JWT secret never wipes everyone's MFA.
  MFA_ENCRYPTION_KEY: strongSecret,
  // Razorpay takes the payments (ADR 0027). The key ID is not secret: the
  // payment page shows it to every customer. rzp_test_ in test mode.
  RAZORPAY_KEY_ID: z
    .string()
    .regex(
      /^rzp_(test|live)_[A-Za-z0-9]{8,}$/,
      'must be a Razorpay key ID: rzp_test_ or rzp_live_, then letters and digits',
    ),
  // Its secret, shown once in the Razorpay dashboard.
  RAZORPAY_KEY_SECRET: z
    .string()
    .regex(
      /^[A-Za-z0-9]{16,}$/,
      'must be the Key Secret from the Razorpay dashboard: at least 16 letters and digits',
    ),
  // Our own secret, which Razorpay signs its webhooks with. Generate it with
  // the command in .env.example, and set it in the dashboard too.
  RAZORPAY_WEBHOOK_SECRET: strongSecret,
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
  const problems: string[] = [];
  if (env.MFA_ENCRYPTION_KEY === env.JWT_ACCESS_SECRET) {
    problems.push(
      'MFA_ENCRYPTION_KEY: must not be the same as JWT_ACCESS_SECRET',
    );
  }
  if (
    env.RAZORPAY_WEBHOOK_SECRET === env.JWT_ACCESS_SECRET ||
    env.RAZORPAY_WEBHOOK_SECRET === env.MFA_ENCRYPTION_KEY
  ) {
    problems.push(
      'RAZORPAY_WEBHOOK_SECRET: must not be the same as JWT_ACCESS_SECRET or MFA_ENCRYPTION_KEY',
    );
  }
  return problems;
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
  if (!env.MEDIA_BASE_URL.startsWith('https://')) {
    problems.push('MEDIA_BASE_URL: must use https in production');
  }
  // With a test key, Razorpay's test cards would pay for real orders.
  if (!env.RAZORPAY_KEY_ID.startsWith('rzp_live_')) {
    problems.push(
      'RAZORPAY_KEY_ID: must be a live key (rzp_live_) in production',
    );
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
