import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const envSchema = z.object({
  // Defaults to production so a forgotten NODE_ENV never enables debug output.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** General per-IP request cap (per minute). A school office behind one public IP shares it — raise it there. */
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(60).max(1_000_000).default(600),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_SSL: bool.default(false),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_ISSUER: z.string().default('school-sms'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  COOKIE_SECURE: bool.default(true),
});

export type Env = z.infer<typeof envSchema>;

/** Validates environment variables once at startup — the app refuses to start with bad config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const problems = securityProblems(env);
  if (problems.length) throw new Error(`Insecure configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return env;
}

/** True only for a database on this machine (exact host match — "localhost.example.com" is NOT local). */
export function isLocalDatabase(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const socket = u.searchParams.get('host');
    if (!host) return !socket || socket.startsWith('/'); // unix socket
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch {
    return false;
  }
}

/** Refuse to start with configuration that would make the API insecure. */
export function securityProblems(env: Env): string[] {
  const p: string[] = [];
  const secret = env.JWT_ACCESS_SECRET;
  if (/replace|change-?me|secret|example|xxxx/i.test(secret)) p.push('JWT_ACCESS_SECRET looks like a placeholder — generate a random one');
  if (new Set(secret).size < 16) p.push('JWT_ACCESS_SECRET has too little variety — use a random value (≥32 chars)');
  const ttl = /^(\d+)([smh])$/.exec(env.JWT_ACCESS_TTL);
  const ttlSeconds = ttl ? Number(ttl[1]) * { s: 1, m: 60, h: 3600 }[ttl[2] as 's' | 'm' | 'h'] : NaN;
  if (!(ttlSeconds > 0 && ttlSeconds <= 3600)) p.push('JWT_ACCESS_TTL must look like 15m / 900s / 1h and be at most 1 hour');
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) p.push('COOKIE_SECURE must be true in production');
    if (env.CORS_ORIGINS.some((o) => !/^https:\/\/[^*\s/]+$/.test(o))) p.push('CORS_ORIGINS must list explicit https:// origins in production (no *, http:// or paths)');
    if (env.BCRYPT_ROUNDS < 12) p.push('BCRYPT_ROUNDS must be at least 12 in production');
    if (!isLocalDatabase(env.DATABASE_URL) && !env.DB_SSL) p.push('DB_SSL must be true when the database is on another host');
  }
  return p;
}
