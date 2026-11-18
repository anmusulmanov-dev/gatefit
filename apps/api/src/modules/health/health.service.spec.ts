import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import { HealthService } from './health.service';

function createService(options: { database?: boolean; redis?: boolean } = {}) {
  const { database = true, redis = true } = options;
  const prisma = {
    $queryRaw: jest.fn(() => (database ? Promise.resolve([1]) : Promise.reject(new Error('db')))),
  } as unknown as PrismaService;
  const redisService = {
    ping: jest.fn(() => (redis ? Promise.resolve() : Promise.reject(new Error('redis')))),
  } as unknown as RedisService;
  return new HealthService(prisma, redisService);
}

describe('HealthService', () => {
  it('reports ok when every dependency answers', async () => {
    await expect(createService().check()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('throws 503 naming the failed database', async () => {
    await expect(createService({ database: false }).check()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      details: { checks: { database: 'down', redis: 'up' } },
    });
  });

  it('throws 503 naming the failed redis', async () => {
    await expect(createService({ redis: false }).check()).rejects.toMatchObject({
      status: 503,
      details: { checks: { database: 'up', redis: 'down' } },
    });
  });

  it('treats a hanging dependency as down', async () => {
    jest.useFakeTimers();
    try {
      const prisma = { $queryRaw: jest.fn(() => new Promise(() => undefined)) };
      const redis = { ping: jest.fn(() => Promise.resolve()) };
      const service = new HealthService(
        prisma as unknown as PrismaService,
        redis as unknown as RedisService,
      );
      const result = expect(service.check()).rejects.toMatchObject({
        details: { checks: { database: 'down', redis: 'up' } },
      });
      await jest.advanceTimersByTimeAsync(2000);
      await result;
    } finally {
      jest.useRealTimers();
    }
  });
});
