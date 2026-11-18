import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// The repo keeps a single .env at the root; CI provides variables directly.
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` does not connect, so a missing URL must not break installs.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
