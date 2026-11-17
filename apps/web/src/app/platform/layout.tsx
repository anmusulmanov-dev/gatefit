import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { isPlatformHost, requestHost } from '@/lib/host';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Gatefit's back office exists only at the admin address; anywhere else it is a 404. */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  if (!isPlatformHost(await requestHost())) {
    notFound();
  }
  return children;
}
