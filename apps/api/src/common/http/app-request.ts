import type { Permission, SessionAudience } from '@gatefit/shared';
import type { Request } from 'express';

/** The organization a request addresses, resolved from its subdomain. */
export interface ResolvedTenant {
  id: string;
  slug: string;
  locale: string;
}

/** Who is calling, taken from a verified access token. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  audience: SessionAudience;
}

/** What the caller may do, loaded from the database on every request. */
export interface AccessContext {
  /** Null for member sessions. */
  staff: {
    id: string;
    role: { id: string; name: string; isSystem: boolean };
    permissions: ReadonlySet<Permission>;
    locations: { id: string; name: string; timezone: string }[];
  } | null;
}

/** Express request with the fields our middleware, guards and interceptors attach. */
export interface AppRequest extends Request {
  /** Set by TenantResolutionMiddleware when the host is an organization subdomain. */
  tenant?: ResolvedTenant;
  /** Set by AuthGuard. Its presence makes TenantTransactionInterceptor open a transaction. */
  organizationId?: string;
  /** Set by AuthGuard. */
  auth?: AuthContext;
  /** Set by AccessInterceptor. */
  access?: AccessContext;
}
