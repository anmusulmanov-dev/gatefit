import { ErrorCode } from '@gatefit/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

export type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok';
  checks: { database: DependencyStatus; redis: DependencyStatus };
}

const CHECK_TIMEOUT_MS = 2000;

async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Health check timed out'));
    }, CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Resolves when every dependency answers; otherwise throws 503 listing each check. */
  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
    ]);
    const checks = { database, redis };

    if (database === 'down' || redis === 'down') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
        { checks },
      );
    }
    return { status: 'ok', checks };
  }
}
