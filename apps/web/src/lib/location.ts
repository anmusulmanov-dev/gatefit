'use server';

import { cookies } from 'next/headers';

import { getSession } from './session';

const LOCATION_COOKIE = 'gatefit_location';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type Location = { id: string; name: string; timezone: string };

/** The location the staff member is working in: their saved choice, else their first one. */
export async function currentLocation(locations: Location[]): Promise<Location | null> {
  const saved = (await cookies()).get(LOCATION_COOKIE)?.value;
  return locations.find((location) => location.id === saved) ?? locations[0] ?? null;
}

/**
 * Remembers which location the staff member is working in. This is a display preference:
 * the API checks access to a location on every request regardless of this cookie.
 */
export async function selectLocation(locationId: string): Promise<void> {
  const session = await getSession();
  const allowed =
    session.kind === 'authenticated' &&
    session.me.staff?.locations.some((location) => location.id === locationId);
  if (!allowed) {
    return;
  }
  (await cookies()).set(LOCATION_COOKIE, locationId, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
  });
}
