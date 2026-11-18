import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const apiRoot = resolve(__dirname, '../..');
const rootEnv = resolve(apiRoot, '../../.env');

function requireTestUrl(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env or export it.`);
  }
  // This setup drops the whole schema: refuse anything that is not clearly a test database.
  if (!new URL(value).pathname.endsWith('_test')) {
    throw new Error(`${name} must point to a database whose name ends with "_test".`);
  }
  return value;
}

/**
 * Runs once before all test files. Redirects the API configuration to the test database
 * (test workers inherit these variables) and rebuilds it from migrations, so every run
 * starts from the real, empty schema.
 */
export default async function globalSetup(): Promise<void> {
  if (existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }

  const appUrl = requireTestUrl('TEST_DATABASE_URL');
  const adminUrl = requireTestUrl('TEST_DATABASE_ADMIN_URL');
  process.env.DATABASE_URL = appUrl;
  process.env.DATABASE_ADMIN_URL = adminUrl;

  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  try {
    await admin.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await admin.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await admin.$disconnect();
  }

  execSync('pnpm exec prisma migrate deploy', { cwd: apiRoot, env: process.env, stdio: 'pipe' });
}
