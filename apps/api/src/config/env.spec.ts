import { validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  DATABASE_ADMIN_URL: 'postgresql://admin:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
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

  it('rejects a short JWT secret and a malformed encryption key', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...valid, DATA_ENCRYPTION_KEY: 'abc' })).toThrow(
      /DATA_ENCRYPTION_KEY/,
    );
  });

  it('refuses the console SMS driver in production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/SMS_DRIVER/);
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production', APP_ENV: 'production' })).toThrow(
      /SMS_DRIVER/,
    );
    expect(() => validateEnv({ ...valid, APP_ENV: 'production' })).toThrow(/SMS_DRIVER/);
  });

  it('allows the console SMS driver on staging built for production', () => {
    expect(validateEnv({ ...valid, NODE_ENV: 'production', APP_ENV: 'staging' })).toMatchObject({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      SMS_DRIVER: 'console',
    });
  });

  it('refuses the memory storage driver in production', () => {
    expect(validateEnv(valid).STORAGE_DRIVER).toBe('s3');
    expect(() =>
      validateEnv({
        ...valid,
        APP_ENV: 'production',
        SMS_DRIVER: 'console',
        STORAGE_DRIVER: 'memory',
      }),
    ).toThrow(/STORAGE_DRIVER/);
    expect(validateEnv({ ...valid, STORAGE_DRIVER: 'memory' }).STORAGE_DRIVER).toBe('memory');
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
