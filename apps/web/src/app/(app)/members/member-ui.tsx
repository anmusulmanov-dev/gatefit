'use client';

import type { DownloadedFile, LocationDto, MemberStatus } from '@gatefit/shared';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { useApiGet } from '@/lib/use-api';

import type { MemberScope } from './member-scope';

const statusTone: Record<MemberStatus, 'neutral' | 'positive' | 'warning' | 'muted'> = {
  inactive: 'muted',
  active: 'positive',
  frozen: 'neutral',
  expired: 'warning',
  debtor: 'warning',
  blocked: 'warning',
};

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  const t = useTranslations('memberFile.status');
  return <Badge tone={statusTone[status]}>{t(status)}</Badge>;
}

/** Initials in a circle, or the photo when there is one. */
export function MemberAvatar({
  name,
  photoUrl,
  size = 'sm',
}: {
  name: string;
  photoUrl: string | null;
  size?: 'sm' | 'lg';
}) {
  const t = useTranslations('members.photo');
  const box = size === 'lg' ? 'size-32 text-3xl' : 'size-10 text-sm';
  if (photoUrl) {
    return (
      // Signed links from our own API; next/image would add nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={t('alt', { name })}
        className={`${box} shrink-0 rounded-full border object-cover`}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-secondary-foreground`}
    >
      {initials}
    </span>
  );
}

/** Locations the staff member may put members in: all for organization-wide roles. */
export function useMemberLocations(scope: MemberScope) {
  const locations = useApiGet<LocationDto[]>('/locations');
  const active = (locations.data ?? []).filter((location) => !location.archived);
  return {
    ...locations,
    data: locations.data
      ? scope.organizationWide
        ? active
        : active.filter((location) => scope.locationIds.includes(location.id))
      : null,
  };
}

/** Hands a generated file to the browser as a download. */
export function saveFile(file: DownloadedFile, fallbackName: string) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName ?? fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const fullName = (member: { firstName: string; lastName: string }) =>
  `${member.lastName} ${member.firstName}`.trim();
