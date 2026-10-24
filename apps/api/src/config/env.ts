import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
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
  JWT_ACCESS_SECRET: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{43,}$/,
      'must be at least 43 letters, digits, "-" or "_" (see .env.example)',
    )
    .refine(
      (secret) => new Set(secret).size >= 16,
      'is too repetitive to be random (see .env.example)',
    ),
});

export type Env = z.infer<typeof envSchema>;

// Settings whose .env.example values are placeholders.
const PLACEHOLDER_KEYS = [
  'DATABASE_URL',
  'VALKEY_URL',
  'JWT_ACCESS_SECRET',
] as const;

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
  if (result.data.NODE_ENV === 'production') {
    const problems = productionProblems(result.data);
    if (problems.length > 0) {
      throw configError(problems);
    }
  }
  return result.data;
}
