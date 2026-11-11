import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RedisService } from '../src/common/redis/redis.service';

// Requires PostgreSQL and Redis: docker compose -f infra/docker-compose.dev.yml up -d
describe('API skeleton (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health reports ok with live dependencies', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('GET /api/v1/health returns 503 in the unified format when a dependency is down', async () => {
    const redis = app.get(RedisService);
    const ping = jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('down'));

    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
    expect(response.body).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service unavailable',
      details: { checks: { database: 'up', redis: 'down' } },
    });
    ping.mockRestore();
  });

  it('unknown routes use the unified error format', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(response.body).toEqual({
      code: 'NOT_FOUND',
      message: expect.any(String) as string,
      details: null,
    });
  });

  it('generates a request ID when none is sent', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed incoming request ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'trace-123');
    expect(response.headers['x-request-id']).toBe('trace-123');
  });

  it('replaces a malformed incoming request ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'bad id with spaces');
    expect(response.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('serves the OpenAPI document', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const document = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toContain('/api/v1/health');
  });
});
