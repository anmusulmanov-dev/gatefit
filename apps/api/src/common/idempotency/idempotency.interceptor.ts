import { createHash } from 'node:crypto';
import { ErrorCode, IDEMPOTENCY_HEADER, idempotencyKeySchema } from '@gatefit/shared';
import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import type { Response } from 'express';
import { from, mergeMap, type Observable, of, switchMap } from 'rxjs';
import type { Prisma } from '../../generated/prisma/client';
import { AppException } from '../errors/app.exception';
import type { AppRequest } from '../http/app-request';
import { TenantDb } from '../tenancy/tenant-db.service';

/** Fingerprint of a request: the same key may only ever be sent with the same request. */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${path} ${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

/**
 * Money requests carry an Idempotency-Key (CLAUDE.md rule 6). The first request with a key
 * runs and its answer is stored in the same transaction as its effects; a repeat gets that
 * answer back without running again. Two requests racing with one key are serialized by
 * the primary key: the second waits for the first to commit, then replays it (or runs, if
 * the first rolled back). Keys are kept per organization.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<Response>();
    const parsed = idempotencyKeySchema.safeParse(req.header(IDEMPOTENCY_HEADER));
    if (!parsed.success) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        `Send a unique ${IDEMPOTENCY_HEADER} header (8-100 letters, digits, - or _)`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const organizationId = req.organizationId;
    if (!organizationId) {
      throw new Error('@Idempotent() needs a request scoped to an organization');
    }
    const key = parsed.data;
    const hash = requestHash(req.method, req.path, req.body);
    const tx = this.tenantDb.tx;
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);

    return from(
      (async () => {
        const { count } = await tx.idempotencyKey.createMany({
          data: [{ organizationId, key, requestHash: hash }],
          skipDuplicates: true,
        });
        if (count === 1) {
          return null;
        }
        const stored = await tx.idempotencyKey.findUniqueOrThrow({
          where: { organizationId_key: { organizationId, key } },
        });
        if (stored.requestHash !== hash) {
          throw new AppException(
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            'This key was already used for a different request',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        if (stored.statusCode === null) {
          // Cannot happen once the first request has committed; be safe.
          throw new AppException(
            ErrorCode.CONFLICT,
            'The first request with this key is still running',
            HttpStatus.CONFLICT,
          );
        }
        return stored;
      })(),
    ).pipe(
      switchMap((stored) => {
        if (stored) {
          res.status(stored.statusCode ?? status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(stored.response);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await tx.idempotencyKey.update({
              where: { organizationId_key: { organizationId, key } },
              data: {
                statusCode: status,
                response: (body ?? null) as Prisma.InputJsonValue,
              },
            });
            return body;
          }),
        );
      }),
    );
  }
}

/** Marks a money endpoint: it requires an Idempotency-Key and replays repeats. */
export function Idempotent() {
  return applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: IDEMPOTENCY_HEADER,
      required: true,
      description: 'Unique per operation; a repeat returns the first answer',
    }),
  );
}
