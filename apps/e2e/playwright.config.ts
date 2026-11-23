import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import {
  API_LOG,
  API_PORT,
  apiEnv,
  MEMBER_PORT,
  OPERATOR_STATE,
  organizationUrl,
  OWNER_STATE,
  WEB_PORT,
  webEnv,
} from './support/env.ts';

// Start with `pnpm test:e2e` from the repo root: scripts/prepare.ts builds the apps and
// resets the e2e database first. The servers below serve those builds on their own ports.

const ci = Boolean(process.env.CI);
mkdirSync(dirname(API_LOG), { recursive: true });

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
    // The member sold to in owner/reception-sale.spec.ts signs in to the member app.
    { name: 'member', testMatch: 'member-app.spec.ts', dependencies: ['owner'] },
    // The reception screen without internet, checking the code of that member.
    {
      name: 'offline',
      testMatch: 'offline/**/*.spec.ts',
      dependencies: ['member'],
      use: { storageState: OWNER_STATE },
    },
    // Signs the operator in for the first time and saves the session.
    { name: 'platform', testMatch: 'platform-auth.spec.ts' },
    {
      name: 'operator',
      testMatch: 'operator/**/*.spec.ts',
      dependencies: ['platform'],
      use: { storageState: OPERATOR_STATE },
    },
  ],
  webServer: [
    {
      // The output goes to a file: the console SMS driver prints sign-in codes there.
      command: `pnpm --filter api start > "${API_LOG}" 2>&1`,
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: apiEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
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
    {
      command: `pnpm --filter member exec next start -p ${MEMBER_PORT}`,
      url: `http://localhost:${MEMBER_PORT}/login`,
      env: webEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
