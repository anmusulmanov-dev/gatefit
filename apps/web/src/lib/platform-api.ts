import { createApiClient } from '@gatefit/shared';

/**
 * Browser-side client for the platform API. Platform sessions do not refresh: an operator
 * whose session ended signs in again with their authenticator.
 */
export const platformApi = createApiClient('staff', {
  prefix: '/api/v1/platform',
  refreshOnExpiry: false,
});
