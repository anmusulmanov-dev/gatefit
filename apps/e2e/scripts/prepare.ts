import { execSync } from 'node:child_process';
import { apiEnv, E2E_DATABASE, repoRoot, webEnv } from '../support/env.ts';

// Runs before `playwright test`: builds the API and the web app, then rebuilds the e2e
// database from migrations and seeds it, so every run starts from the same state.
// Set E2E_SKIP_BUILD=1 to reuse the previous builds.

function run(command: string, env: Record<string, string> = {}, input?: string): void {
  console.log(`\n> ${command}`);
  execSync(command, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    ...(input === undefined
      ? { stdio: 'inherit' }
      : { input, stdio: ['pipe', 'inherit', 'inherit'] }),
  });
}

if (process.env.E2E_SKIP_BUILD !== '1') {
  // Also builds the shared packages the web app needs.
  run('pnpm exec turbo run build --filter=api');
  run('pnpm --filter web exec next build', webEnv());
}

const env = apiEnv();
// This drops a whole schema: refuse anything but the e2e database.
if (!new URL(env.DATABASE_ADMIN_URL ?? '').pathname.endsWith(`/${E2E_DATABASE}`)) {
  throw new Error(`Refusing to reset a database other than ${E2E_DATABASE}`);
}
// The same reset as the API's integration tests (apps/api/test/support/global-setup.ts).
// The first deploy creates the database when it is missing.
run('pnpm --filter api exec prisma migrate deploy', env);
run(
  'pnpm --filter api exec prisma db execute --stdin',
  env,
  'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
);
run('pnpm --filter api exec prisma migrate deploy', env);
run('pnpm --filter api seed', env);
