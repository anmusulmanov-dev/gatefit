import type { AccessEventDto } from '@gatefit/shared';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../../common/redis/redis.service';

type Listener = (event: AccessEventDto) => void;

const channelOf = (organizationId: string, locationId: string) =>
  `access:${organizationId}:${locationId}`;

/**
 * The live feed of a location's entries for reception screens. Published through Redis so
 * every API instance's screens hear it, whichever instance recorded the entry. One
 * subscriber connection per process, opened when the first screen listens.
 */
@Injectable()
export class AccessEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(AccessEventsService.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber: Redis | null = null;

  constructor(private readonly redis: RedisService) {}

  publish(organizationId: string, event: AccessEventDto): void {
    this.redis.client
      .publish(channelOf(organizationId, event.checkIn.location.id), JSON.stringify(event))
      .catch((error: unknown) => {
        // A missed live update is not lost data: the journal still has the entry.
        this.logger.warn(`Live feed publish failed: ${(error as Error).message}`);
      });
  }

  /** Starts listening; call the returned function to stop. */
  subscribe(organizationId: string, locationId: string, listener: Listener): () => void {
    const channel = channelOf(organizationId, locationId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      void this.connection().subscribe(channel);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(channel);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listeners.delete(channel);
        void this.subscriber?.unsubscribe(channel);
      }
    };
  }

  onModuleDestroy(): void {
    this.subscriber?.disconnect();
  }

  private connection(): Redis {
    if (!this.subscriber) {
      const subscriber = this.redis.client.duplicate();
      subscriber.on('error', (error: Error) => {
        this.logger.warn(`Live feed connection error: ${error.message}`);
      });
      subscriber.on('message', (channel: string, message: string) => {
        const set = this.listeners.get(channel);
        if (!set) {
          return;
        }
        const event = JSON.parse(message) as AccessEventDto;
        for (const listener of set) {
          listener(event);
        }
      });
      this.subscriber = subscriber;
    }
    return this.subscriber;
  }
}
