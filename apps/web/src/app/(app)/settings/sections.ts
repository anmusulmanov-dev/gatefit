import type { Permission } from '@gatefit/shared';

/** Settings sections, in menu order, with the permission that opens each one. */
export const SETTINGS_SECTIONS = [
  { slug: 'organization', permission: 'organization.read' },
  { slug: 'locations', permission: 'locations.read' },
  { slug: 'staff', permission: 'staff.read' },
  { slug: 'roles', permission: 'roles.read' },
  // Everyone may manage their own account.
  { slug: 'account', permission: null },
] as const satisfies readonly { slug: string; permission: Permission | null }[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['slug'];

export function visibleSections(permissions: readonly string[]): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(
    (section) => section.permission === null || permissions.includes(section.permission),
  ).map((section) => section.slug);
}
