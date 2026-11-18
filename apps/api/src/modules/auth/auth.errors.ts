import { ErrorCode } from '@gatefit/shared';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';

export const unauthorized = (message = 'Authentication required') =>
  new AppException(ErrorCode.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED);

// One message for a wrong phone and a wrong password: the API must not reveal which.
export const invalidCredentials = () =>
  new AppException(
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid phone or password',
    HttpStatus.UNAUTHORIZED,
  );

export const totpRequired = () =>
  new AppException(ErrorCode.TOTP_REQUIRED, 'Authenticator code required', HttpStatus.UNAUTHORIZED);

export const invalidTotp = () =>
  new AppException(ErrorCode.INVALID_TOTP, 'Invalid authenticator code', HttpStatus.UNAUTHORIZED);

export const totpSetupRequired = (setupToken: string) =>
  new AppException(
    ErrorCode.TOTP_SETUP_REQUIRED,
    'This role must set up an authenticator app before signing in',
    HttpStatus.FORBIDDEN,
    { setupToken },
  );

export const totpAlreadyEnabled = () =>
  new AppException(ErrorCode.CONFLICT, 'Authenticator app is already set up', HttpStatus.CONFLICT);

export const invalidOtp = () =>
  new AppException(ErrorCode.INVALID_OTP, 'Invalid code', HttpStatus.UNAUTHORIZED);

export const otpExpired = () =>
  new AppException(ErrorCode.OTP_EXPIRED, 'Code has expired', HttpStatus.UNAUTHORIZED);

export const otpAttemptsExceeded = () =>
  new AppException(
    ErrorCode.OTP_ATTEMPTS_EXCEEDED,
    'Too many wrong attempts, request a new code',
    HttpStatus.UNAUTHORIZED,
  );

export const organizationRequired = () =>
  new AppException(
    ErrorCode.ORGANIZATION_NOT_FOUND,
    'This endpoint must be called on an organization subdomain',
    HttpStatus.NOT_FOUND,
  );

export const permissionDenied = () =>
  new AppException(ErrorCode.PERMISSION_DENIED, 'Permission denied', HttpStatus.FORBIDDEN);
