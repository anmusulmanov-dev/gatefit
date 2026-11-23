import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Shared by scripts/prepare.ts (database and builds) and playwright.config.ts (servers),
// so both agree on where the end-to-end stack lives.

export const repoRoot = resolve(import.meta.dirname, '../../..');

// The repo keeps one .env at its root; CI sets variables directly. Set variables win.
const rootEnv = resolve(repoRoot, '.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env or export it.`);
  }
  return value;
}

/** The same server and credentials as DATABASE_URL, but the e2e database. */
function e2eDatabase(name: string): string {
  const url = new URL(requireEnv(name));
  url.pathname = `/${E2E_DATABASE}`;
  return url.toString();
}

// Ports of their own, so the suite runs next to `pnpm dev` (3000 and 8000). Not 8100:
// Windows (Hyper-V) may reserve ranges around it, see `netsh int ipv4 show excludedportrange`.
export const API_PORT = 7100;
export const WEB_PORT = 3100;
export const MEMBER_PORT = 3101;
export const E2E_DATABASE = 'gatefit_e2e';
// The web app is built into its own directory: its API address is fixed at build time.
export const WEB_DIST_DIR = '.next-e2e';

export const OWNER = { phone: '+998900000101', password: 'e2e-owner-password' };
export const OPERATOR = { phone: '+998900000109', password: 'e2e-operator-password' };

/** The owner's signed-in session, saved by staff-auth.spec.ts for the tests that follow. */
export const OWNER_STATE = '.auth/owner.json';
/** The operator's session, saved by platform-auth.spec.ts. */
export const OPERATOR_STATE = '.auth/operator.json';
/** The member's session in the member app, saved by member-app.spec.ts. */
export const MEMBER_STATE = '.auth/member.json';

/**
 * Everything the e2e API prints, SMS included: the console SMS driver writes to stdout, so
 * the member sign-in test reads its code here (support/sms.ts). Git-ignored.
 */
export const API_LOG = resolve(import.meta.dirname, '../.output/api.log');

/** The member reception-sale.spec.ts adds and sells to; later flows use the same person. */
export const SALE_MEMBER = { phone: '+998900009901', firstName: 'Sardor', lastName: 'E2E' };

export const organizationUrl = `http://demo.localhost:${WEB_PORT}`;
export const platformUrl = `http://admin.localhost:${WEB_PORT}`;
export const memberUrl = `http://demo.localhost:${MEMBER_PORT}`;

/** The staff panel of another organization, e.g. one the operator just opened. */
export function organizationUrlOf(slug: string): string {
  return `http://${slug}.localhost:${WEB_PORT}`;
}

function redisUrl(): string {
  // A database of its own, so rate limits and one-time keys never mix with development.
  const url = new URL(requireEnv('REDIS_URL'));
  url.pathname = '/1';
  return url.toString();
}

/** Variables for the API, the seed and the migrations of the e2e stack. */
export function apiEnv(): Record<string, string> {
  return {
    DATABASE_URL: e2eDatabase('DATABASE_URL'),
    DATABASE_ADMIN_URL: e2eDatabase('DATABASE_ADMIN_URL'),
    REDIS_URL: redisUrl(),
    API_PORT: String(API_PORT),
    APP_BASE_DOMAIN: 'localhost',
    TRUST_PROXY: 'true',
    SMS_DRIVER: 'console',
    // Files (member imports, photos) in the API's memory: the suite needs no MinIO, and CI
    // runs only PostgreSQL and Redis.
    STORAGE_DRIVER: 'memory',
    LOG_LEVEL: 'warn',
    // Every request comes from one IP.
    RATE_LIMIT_PER_MINUTE: '1000000',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000000',
    SEED_OWNER_PHONE: OWNER.phone,
    SEED_OWNER_PASSWORD: OWNER.password,
    SEED_PLATFORM_ADMIN_PHONE: OPERATOR.phone,
    SEED_PLATFORM_ADMIN_PASSWORD: OPERATOR.password,
  };
}

/** Variables for building and serving the web and member apps against the e2e API. */
export function webEnv(): Record<string, string> {
  return {
    // The root .env says development, which breaks `next build` and `next start`.
    NODE_ENV: 'production',
    API_INTERNAL_URL: `http://localhost:${API_PORT}`,
    NEXT_DIST_DIR: WEB_DIST_DIR,
  };
}
