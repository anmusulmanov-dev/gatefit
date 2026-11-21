import { defineConfig, devices } from '@playwright/test';
import { API_PORT, apiEnv, organizationUrl, OWNER_STATE, WEB_PORT, webEnv } from './support/env.ts';

// Start with `pnpm test:e2e` from the repo root: scripts/prepare.ts builds the apps and
// resets the e2e database first. The servers below serve those builds on their own ports.

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  // The flows share one database and build on each other (see `dependencies`).
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: organizationUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    // Signs the owner in for the first time (authenticator setup) and saves the session.
    { name: 'staff-auth', testMatch: 'staff-auth.spec.ts' },
    {
      name: 'owner',
      testMatch: 'owner/**/*.spec.ts',
      dependencies: ['staff-auth'],
      use: { storageState: OWNER_STATE },
    },
    { name: 'platform', testMatch: 'platform-auth.spec.ts' },
  ],
  webServer: [
    {
      command: 'pnpm --filter api start',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: apiEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter web exec next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      env: webEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
