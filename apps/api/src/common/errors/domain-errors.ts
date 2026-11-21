import { ErrorCode } from '@gatefit/shared';
import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';

export const notFound = (what: string) =>
  new AppException(ErrorCode.NOT_FOUND, `${what} not found`, HttpStatus.NOT_FOUND);

export const conflict = (code: ErrorCode, message: string, details: unknown = null) =>
  new AppException(code, message, HttpStatus.CONFLICT, details);

export const forbidden = (code: ErrorCode, message: string) =>
  new AppException(code, message, HttpStatus.FORBIDDEN);

export const unprocessable = (code: ErrorCode, message: string, details: unknown = null) =>
  new AppException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);

/** Prisma's error for a violated unique constraint. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}
