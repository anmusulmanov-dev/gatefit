'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { selectLocation } from '@/lib/location';

interface Props {
  locations: { id: string; name: string }[];
  currentId: string | null;
}

/** Lets a staff member with several locations choose the one they are working in. */
export function LocationSelect({ locations, currentId }: Props) {
  const t = useTranslations('web.header');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (locations.length === 0) {
    return <span className="text-sm opacity-75">{t('noLocations')}</span>;
  }

  return (
    <select
      aria-label={t('location')}
      className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground"
      value={currentId ?? ''}
      disabled={pending || locations.length === 1}
      onChange={(event) => {
        const locationId = event.target.value;
        startTransition(async () => {
          await selectLocation(locationId);
          router.refresh();
        });
      }}
    >
      {locations.map((location) => (
        <option key={location.id} value={location.id}>
          {location.name}
        </option>
      ))}
    </select>
  );
}
