import { createApiClient } from '@gatefit/shared';

/** Browser-side API client for the staff panel. One instance, so session refreshes are shared. */
export const api = createApiClient('staff');
