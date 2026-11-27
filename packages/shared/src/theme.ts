import { z } from 'zod';
import { CLIENT_HEADER, type SessionAudience } from './auth';

/**
 * The looks an organization can pick for its staff panel and member app. Colours, type and
 * effects for each live in `packages/shared/styles/themes.css`; see docs/ADR/0012-themes.md.
 */
export const THEMES = ['zumrad', 'olov', 'neon', 'moviy'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'zumrad';
export const themeSchema = z.enum(THEMES);

/** Each theme's brand colour, for browser chrome (PWA theme-color). */
export const THEME_COLORS: Record<Theme, string> = {
  zumrad: '#0f766e',
  olov: '#c2410c',
  neon: '#6d28d9',
  moviy: '#1d4ed8',
};

/** Light or dark is each person's own choice, kept in a cookie by the browser. */
export const COLOR_MODES = ['system', 'light', 'dark'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export const COLOR_MODE_COOKIE = 'gf-mode';

export function parseColorMode(value: string | undefined | null): ColorMode {
  return (COLOR_MODES as readonly string[]).includes(value ?? '') ? (value as ColorMode) : 'system';
}

/** What a page may show about the organization before anyone signs in. */
export interface BrandingDto {
  name: string;
  theme: Theme;
  /** A short-lived link to the organization's logo; null when it has none. */
  logoUrl: string | null;
}

export interface BrandingRequest {
  apiUrl: string;
  audience: SessionAudience;
  host: string | null;
}

/**
 * Asks the API for the organization's name and theme from a web server. Any failure (bare
 * domain, unknown or blocked organization, API down) yields null: pages then use the default.
 */
export async function fetchBranding(request: BrandingRequest): Promise<BrandingDto | null> {
  try {
    const response = await fetch(`${request.apiUrl}/api/v1/branding`, {
      // Per host and changed from the settings page: never shared between requests.
      cache: 'no-store',
      headers: {
        [CLIENT_HEADER]: request.audience,
        ...(request.host ? { 'x-forwarded-host': request.host } : {}),
      },
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Partial<BrandingDto>;
    const theme = themeSchema.safeParse(body.theme);
    return typeof body.name === 'string' && theme.success
      ? {
          name: body.name,
          theme: theme.data,
          logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl : null,
        }
      : null;
  } catch {
    return null;
  }
}
