import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inter,
  Manrope,
  Montserrat,
  Onest,
  Unbounded,
} from 'next/font/google';

// Every theme's faces (packages/shared/styles/themes.css). Only the default theme's are
// preloaded; the browser fetches the others when a theme actually uses them. next/font
// needs literal options, hence the repetition.

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--ff-inter', display: 'swap' });
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  variable: '--ff-manrope',
  display: 'swap',
});
const unbounded = Unbounded({
  subsets: ['latin', 'cyrillic'],
  variable: '--ff-unbounded',
  display: 'swap',
  preload: false,
});
const onest = Onest({
  subsets: ['latin', 'cyrillic'],
  variable: '--ff-onest',
  display: 'swap',
  preload: false,
});
const montserrat = Montserrat({
  subsets: ['latin', 'cyrillic'],
  variable: '--ff-montserrat',
  display: 'swap',
  preload: false,
});
const plexSans = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--ff-plex-sans',
  display: 'swap',
  preload: false,
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600'],
  variable: '--ff-plex-mono',
  display: 'swap',
  preload: false,
});

export const fontVariables = [inter, manrope, unbounded, onest, montserrat, plexSans, plexMono]
  .map((font) => font.variable)
  .join(' ');
