import type { ErrorCode } from '@gatefit/shared';

/** Application error carrying a stable code. Thrown by services, rendered by the global filter. */
export class AppException extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'AppException';
  }
}
