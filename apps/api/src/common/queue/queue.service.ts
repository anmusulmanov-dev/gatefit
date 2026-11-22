import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ConnectionOptions, type Processor, Queue, Worker, type WorkerOptions } from 'bullmq';
import type { Env } from '../../config/env';

/** Namespaces every queue in Redis. Tests give each app its own. */
export const QUEUE_PREFIX = Symbol('QUEUE_PREFIX');

/** BullMQ connection settings from a redis:// or rediss:// URL. */
export function connectionFromUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ workers: commands wait for a reconnect instead of failing.
    maxRetriesPerRequest: null,
  };
}

/**
 * Background jobs (docs/TZ.md section 5.3). The API process runs the workers too; every
 * job must be safe to run again (CLAUDE.md rule 6).
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection: ConnectionOptions;
  private readonly closables: { close(): Promise<void> }[] = [];

  constructor(
    config: ConfigService<Env, true>,
    @Inject(QUEUE_PREFIX) private readonly prefix: string,
  ) {
    this.connection = connectionFromUrl(config.get('REDIS_URL', { infer: true }));
  }

  queue<Data>(name: string): Queue<Data> {
    const queue = new Queue<Data>(name, { connection: this.connection, prefix: this.prefix });
    this.closables.push(queue);
    return queue;
  }

  /** `options` may add settings such as a backoff strategy; the connection is always ours. */
  worker<Data>(
    name: string,
    processor: Processor<Data>,
    options: Omit<WorkerOptions, 'connection' | 'prefix'> = {},
  ): Worker<Data> {
    const worker = new Worker<Data>(name, processor, {
      ...options,
      connection: this.connection,
      prefix: this.prefix,
    });
    worker.on('failed', (job, error) => {
      this.logger.error(`Job ${name}/${job?.id ?? '?'} failed: ${error.message}`);
    });
    worker.on('error', (error) => {
      this.logger.warn(`Worker ${name}: ${error.message}`);
    });
    this.closables.push(worker);
    return worker;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.closables.map((closable) => closable.close()));
  }
}

@Global()
@Module({
  providers: [QueueService, { provide: QUEUE_PREFIX, useValue: 'gatefit' }],
  exports: [QueueService],
})
export class QueueModule {}
