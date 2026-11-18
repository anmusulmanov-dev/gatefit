import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// The repo keeps one .env at its root, which Next does not read. Only the API address is
// taken from it; everything else there belongs to the API.
const rootEnv = resolve(process.cwd(), '../../.env');
const fromRootEnv = existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')) : {};
process.env.API_INTERNAL_URL ??= fromRootEnv.API_INTERNAL_URL ?? 'http://localhost:8000';
const apiUrl = process.env.API_INTERNAL_URL;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The browser talks to the API through this origin, so session cookies stay first-party
  // and the API sees the organization's host. In production Caddy does the same routing.
  rewrites: () => Promise.resolve([{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]),
};

export default withNextIntl(nextConfig);
