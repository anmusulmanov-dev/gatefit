import { readFileSync, statSync } from 'node:fs';
import { expect } from '@playwright/test';
import { API_LOG } from './env.ts';

// The e2e API sends SMS through the console driver, which prints each message to the API's
// output (support/env.ts, API_LOG). A test marks the end of the log before it asks for a
// message, then waits for the message to appear after that mark.

/** The current end of the API log: messages printed after it are new. */
export function smsMark(): number {
  return statSync(API_LOG).size;
}

/** The sign-in code sent to `phone` after `mark`. */
export async function smsCode(phone: string, mark: number): Promise<string> {
  // The phone is E.164 (+ and digits): only the plus needs escaping.
  const line = new RegExp(
    String.raw`\[sms:console\] to \+` + phone.slice(1) + String.raw`: .*?(\d{6})`,
  );
  let code = '';
  await expect
    .poll(
      () => {
        const printed = readFileSync(API_LOG).subarray(mark).toString('utf8');
        code = line.exec(printed)?.[1] ?? '';
        return code;
      },
      { message: `an SMS code for ${phone}`, timeout: 10_000 },
    )
    .not.toBe('');
  return code;
}
