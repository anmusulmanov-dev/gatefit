import { z } from 'zod';
import type { Permission } from './permissions';

/** Phone in E.164. Spaces, dashes and brackets typed by a person are removed first. */
export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s\-()]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in international format'));

const sixDigitCode = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

export const staffLoginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1).max(200),
  /** Sent on the second attempt, after the API answered TOTP_REQUIRED. */
  totpCode: sixDigitCode.optional(),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

export const otpRequestSchema = z.object({ phone: phoneSchema });
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({ phone: phoneSchema, code: sixDigitCode });
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const totpSetupSchema = z.object({
  /** From the TOTP_SETUP_REQUIRED error. Omitted when an already signed-in user enables TOTP. */
  setupToken: z.string().min(1).optional(),
});
export type TotpSetupInput = z.infer<typeof totpSetupSchema>;

export const totpConfirmSchema = z.object({
  enrollToken: z.string().min(1),
  code: sixDigitCode,
});
export type TotpConfirmInput = z.infer<typeof totpConfirmSchema>;

export interface TotpSetupResponse {
  /** Base32 secret for manual entry into an authenticator app. */
  secret: string;
  /** otpauth:// URI to render as a QR code. */
  otpauthUrl: string;
  /** Passed back to /auth/totp/confirm together with the first code. */
  enrollToken: string;
}

export type SessionAudience = 'staff' | 'member';

/** Which app is calling: selects the cookie pair, so both apps can share a host in development. */
export const CLIENT_HEADER = 'x-gatefit-client';

export interface MeResponse {
  audience: SessionAudience;
  user: { id: string; phone: string };
  organization: { id: string; name: string; slug: string; locale: string; currency: string };
  /** Present for staff sessions only. */
  staff: {
    id: string;
    role: { id: string; name: string; isSystem: boolean };
    permissions: Permission[];
    locations: { id: string; name: string; timezone: string }[];
  } | null;
}
