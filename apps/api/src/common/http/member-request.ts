import { ErrorCode } from '@gatefit/shared';
import { forbidden } from '../errors/domain-errors';
import type { AppRequest } from './app-request';

/** The signed-in member app user, as /me/* endpoints of the member app need them. */
export interface MemberUser {
  organizationId: string;
  userId: string;
}

/**
 * For handlers behind @AnyAuthenticated that serve the member app only: a staff session
 * gets 403. Which member the user is follows from the session, never from the request.
 */
export function memberUser(req: AppRequest): MemberUser {
  if (req.auth?.audience !== 'member' || !req.organizationId) {
    throw forbidden(ErrorCode.PERMISSION_DENIED, 'Only for the member app');
  }
  return { organizationId: req.organizationId, userId: req.auth.userId };
}
