import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// The repo keeps a single .env at the root; CI provides variables directly.
// Variables that are already set (CI, test setup) are not overridden by the file.
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'pnpm run seed' },
  // Migrations run as gatefit_migrator, the schema owner. The API itself uses DATABASE_URL
  // (gatefit_app). `prisma generate` does not connect, so a missing URL must not break installs.
  datasource: { url: process.env.DATABASE_ADMIN_URL ?? '' },
});
