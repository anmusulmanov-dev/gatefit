/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // *.spec.ts: unit tests next to the code. test/*.int-spec.ts: integration tests
  // that need PostgreSQL and Redis from infra/docker-compose.dev.yml.
  testRegex: '.*\\.(spec|int-spec)\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/main.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  // Points the run at the test database and rebuilds its schema from migrations.
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  // Integration hooks create apps and hash passwords (Argon2); 5 s is too tight on CI runners.
  testTimeout: 30000,
};
