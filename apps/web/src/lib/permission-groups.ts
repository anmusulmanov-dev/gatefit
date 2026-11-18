import { type Permission, PERMISSIONS } from '@gatefit/shared';

type Area = Permission extends `${infer A}.${string}` ? A : never;

/** Permissions grouped by area (`members.read` belongs to `members`), in catalogue order. */
export const PERMISSION_GROUPS: { area: Area; permissions: Permission[] }[] = PERMISSIONS.reduce<
  { area: Area; permissions: Permission[] }[]
>((groups, permission) => {
  const area = permission.split('.')[0] as Area;
  const group = groups.find((candidate) => candidate.area === area);
  if (group) {
    group.permissions.push(permission);
  } else {
    groups.push({ area, permissions: [permission] });
  }
  return groups;
}, []);
