import { defaultLocale, messages } from '@gatefit/i18n';
import type { MetadataRoute } from 'next';

// The manifest is fetched without the user's cookie context, so it uses the default locale.
export default function manifest(): MetadataRoute.Manifest {
  const t = messages[defaultLocale];

  return {
    name: t.common.appName,
    short_name: t.common.appName,
    description: t.member.home.subtitle,
    lang: defaultLocale,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#171717',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
