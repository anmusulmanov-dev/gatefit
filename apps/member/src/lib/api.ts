import { createApiClient } from '@gatefit/shared';

/** Browser-side API client for the member app. One instance, so session refreshes are shared. */
export const api = createApiClient('member');
