import type { RateLimit } from '../../common/rate-limit/rate-limiter.service';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

// Two tabs can refresh at the same moment; the loser must not be treated as token theft.
export const REFRESH_REUSE_GRACE_SECONDS = 10;

export const TOTP_SETUP_TOKEN_TTL_SECONDS = 10 * 60;
// One 30-second step either side, for clock drift between phone and server.
export const TOTP_TOLERANCE_SECONDS = 30;

export const OTP_TTL_SECONDS = 5 * 60;
// A code read out at the front desk: the member may still have to open the app.
export const DESK_OTP_TTL_SECONDS = 15 * 60;
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Per phone number, per organization. For sign-in these count failed attempts only: a
 * success clears the counter. Per-IP limits are in RateLimitGuard.
 */
export const LOGIN_LIMIT: RateLimit = { limit: 10, windowSeconds: 15 * 60 };
export const OTP_REQUEST_LIMIT: RateLimit = { limit: 3, windowSeconds: 10 * 60 };
export const TOTP_LIMIT: RateLimit = { limit: 10, windowSeconds: 15 * 60 };
