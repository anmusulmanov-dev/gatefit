import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

// Drivers that print messages instead of sending them.
const DEV_ONLY_SMS_DRIVERS: readonly string[] = ['console'];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Where this deployment runs. Staging builds with NODE_ENV=production (secure cookies,
    // optimized code) but is not production: it may use development drivers. Unset means
    // the same as NODE_ENV.
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(8000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    // Organizations live at <slug>.<APP_BASE_DOMAIN>.
    APP_BASE_DOMAIN: z.string().min(1).default('localhost'),
    // Behind a reverse proxy (Caddy, the Next dev proxy): trust X-Forwarded-* headers.
    TRUST_PROXY: booleanFlag.default(false),

    // gatefit_app: every tenant request, always under row-level security.
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // gatefit_migrator: the platform module only. Bypasses row-level security.
    DATABASE_ADMIN_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    // Signs access tokens.
    JWT_SECRET: z.string().min(32),
    // 32 random bytes, base64. Encrypts TOTP secrets and keys the OTP code hash.
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes in base64'),

    SMS_DRIVER: z.enum(['console']).default('console'),

    // Requests per minute from one IP: all endpoints, and sign-in endpoints separately.
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),

    S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
    S3_REGION: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
  })
  .superRefine((env, context) => {
    // The console driver prints sign-in codes: acceptable on a developer machine and on
    // staging (no real users), never in production.
    const appEnv = env.APP_ENV ?? env.NODE_ENV;
    if (appEnv === 'production' && DEV_ONLY_SMS_DRIVERS.includes(env.SMS_DRIVER)) {
      context.addIssue({
        code: 'custom',
        path: ['SMS_DRIVER'],
        message: 'the console driver is not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses raw environment variables. Throws with a readable list of problems so
 * the app refuses to start on a broken configuration. Values are never echoed.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
