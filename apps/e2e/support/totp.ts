import { generateSync } from 'otplib';

const STEP_SECONDS = 30;

/** The authenticator code for `secret`, `stepsAhead` 30-second steps from now. */
export function totpCode(secret: string, stepsAhead = 0): string {
  const epoch = Math.floor(Date.now() / 1000) + stepsAhead * STEP_SECONDS;
  return generateSync({ secret, epoch });
}

/**
 * A code the API has not seen yet. It accepts each code only once per user, and also the
 * next step's code, so a second sign-in within the same 30 seconds needs no waiting.
 */
export function unusedTotpCode(secret: string, used: string): string {
  const now = totpCode(secret);
  return now === used ? totpCode(secret, 1) : now;
}
