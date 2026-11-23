import { type ApiError, ErrorCode } from '@gatefit/shared';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import { AppException } from './app.exception';

export interface ErrorResponse {
  status: number;
  body: ApiError;
}

const codeByStatus: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.FILE_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

const internalError: ErrorResponse = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  body: { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error', details: null },
};

function fromHttpException(exception: HttpException): ErrorResponse {
  const status = exception.getStatus();
  const code = codeByStatus[status];
  if (!code) {
    // Unmapped 5xx must not leak internals; unmapped 4xx is a generic client error.
    return status >= 500
      ? internalError
      : {
          status,
          body: { code: ErrorCode.BAD_REQUEST, message: exception.message, details: null },
        };
  }

  const response = exception.getResponse();
  const payload =
    typeof response === 'object' ? (response as { message?: unknown; details?: unknown }) : {};
  // Nest's built-in pipes put a list of problems into `message`.
  const details = Array.isArray(payload.message) ? payload.message : (payload.details ?? null);

  return { status, body: { code, message: exception.message, details } };
}

/** Maps anything thrown inside a request to the single `{ code, message, details }` shape. */
export function toErrorResponse(exception: unknown): ErrorResponse {
  if (exception instanceof AppException) {
    return {
      status: exception.status,
      body: { code: exception.code, message: exception.message, details: exception.details },
    };
  }

  if (exception instanceof ZodError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed',
        details: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    };
  }

  if (exception instanceof HttpException) {
    return fromHttpException(exception);
  }

  return internalError;
}
