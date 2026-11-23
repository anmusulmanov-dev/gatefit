/** The request as pino-http's standard serializer gives it. */
export interface SerializedRequest {
  id?: unknown;
  method?: string;
  url?: string;
  query?: unknown;
  params?: unknown;
  headers?: Record<string, unknown>;
  remoteAddress?: string;
  remotePort?: number;
}

/**
 * What a request log line keeps: no query string and no query or path values, which can
 * hold phones (member search), codes or tokens (CLAUDE.md rule 9). Ids in the path stay:
 * they are needed to trace a request and are not personal data.
 */
export function requestForLog(req: SerializedRequest): SerializedRequest {
  const url = req.url ?? '';
  const queryAt = url.indexOf('?');
  return {
    id: req.id,
    method: req.method,
    url: queryAt === -1 ? url : `${url.slice(0, queryAt)}?[redacted]`,
    headers: req.headers,
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  };
}
