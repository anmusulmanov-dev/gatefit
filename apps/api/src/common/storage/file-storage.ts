import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

/** A stored file as read back. */
export interface StoredFile {
  body: Readable;
  contentType: string;
}

/**
 * Port for file storage (CLAUDE.md rule 8). Keys are paths such as
 * `orgs/<organizationId>/members/<memberId>/photo-<id>.jpg`; every key starts with the
 * organization it belongs to. Files reach browsers only through signed links
 * (FileLinksService), never directly.
 */
export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Null when there is no such file. */
  get(key: string): Promise<StoredFile | null>;
  /** Deleting a missing file is not an error. */
  delete(key: string): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** Any S3-compatible service: MinIO in development and on our own servers. */
export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
      // MinIO serves buckets as paths, not as subdomains.
      forcePathStyle: true,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<StoredFile | null> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!(object.Body instanceof Readable)) {
        return null;
      }
      return {
        body: object.Body,
        contentType: object.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      if (error instanceof NoSuchKey) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Keeps files in process memory. For tests and machines without MinIO; never production. */
export class MemoryFileStorage implements FileStorage {
  private readonly files = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.files.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<StoredFile | null> {
    const file = this.files.get(key);
    return Promise.resolve(
      file ? { body: Readable.from([file.body]), contentType: file.contentType } : null,
    );
  }

  delete(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }

  /** For tests. */
  keys(): string[] {
    return [...this.files.keys()];
  }
}

/** Reads a whole stored file; for files the API itself processes (imports). */
export async function readAll(file: StoredFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of file.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

// A new driver is added here and to the STORAGE_DRIVER enum in src/config/env.ts.
const drivers: Record<Env['STORAGE_DRIVER'], (config: ConfigService<Env, true>) => FileStorage> = {
  s3: (config) => new S3FileStorage(config),
  memory: () => new MemoryFileStorage(),
};

@Global()
@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): FileStorage =>
        drivers[config.get('STORAGE_DRIVER', { infer: true })](config),
    },
  ],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
