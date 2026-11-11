import type { Permission } from '@gatefit/shared';
import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'gatefit:public';
export const ANY_AUTHENTICATED_KEY = 'gatefit:any-authenticated';
export const PERMISSIONS_KEY = 'gatefit:permissions';

// Every endpoint carries exactly one of the three markers below. An endpoint with none is
// refused at runtime and fails test/endpoint-protection.int-spec.ts.

/** No sign-in needed: health, the sign-in endpoints themselves. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Any signed-in user, staff or member, acting on their own account (profile, sign-out). */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED_KEY, true);

/** Staff only, and the staff member's role must hold every listed permission. */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
