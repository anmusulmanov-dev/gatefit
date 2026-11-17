import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

import { visibleSections } from './sections';

/** Opens the first settings section the staff member may see. */
export default async function SettingsIndex() {
  const session = await getSession();
  const permissions = session.kind === 'authenticated' ? (session.me.staff?.permissions ?? []) : [];
  redirect(`/settings/${visibleSections(permissions)[0] ?? 'account'}`);
}
