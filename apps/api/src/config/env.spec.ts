import { validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET: 'bucket',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(8000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('coerces the port and splits CORS origins', () => {
    const env = validateEnv({
      ...valid,
      API_PORT: '4100',
      CORS_ORIGINS: 'http://localhost:3000, http://localhost:3001,',
    });
    expect(env.API_PORT).toBe(4100);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });

  it('rejects a missing database URL and names the variable', () => {
    const { DATABASE_URL: _omitted, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL with the wrong protocol', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...valid, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('does not echo secret values in the error', () => {
    let message = '';
    try {
      validateEnv({ ...valid, DATABASE_URL: 'mysql://user:hunter2@localhost/db' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('hunter2');
  });
});
