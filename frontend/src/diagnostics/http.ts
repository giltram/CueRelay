import { diagnosticId } from './identifier';
import { diagnostics, safeError } from './index';
export let backendBuild = 'unknown';
const traces = new WeakMap<Response, string>();
export const responseRequestId = (response: Response) => traces.get(response);
export class ResponseUnknownError extends Error {
  readonly code = 'response_unknown';
  constructor(public requestId: string) { super('未收到服务器响应，操作结果未知；请重载确认后再重试。'); }
}
/** Deliberately never observes request/response bodies or authentication headers. */
export async function diagnosticFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const scope = diagnostics.scope(), requestId = diagnosticId(), start = performance.now();
  const context = { ...diagnostics.contextSnapshot() };
  const ids = path.match(/\/organizations\/(\d+)(?:\/projects\/(\d+))?/);
  if (ids) { context.organizationId = Number(ids[1]); context.projectId = ids[2] ? Number(ids[2]) : undefined; }
  const method = init.method || 'GET';
  const headers = new Headers(init.headers); headers.set('X-Request-ID', requestId);
  const data = { requestId, method, route: path };
  diagnostics.record('http', 'request', 'start', data, scope, context);
  try {
    const response = await fetch(path, { ...init, headers: Object.fromEntries(headers.entries()) });
    traces.set(response, requestId);
    const build = response.headers?.get('X-CueRelay-Build');
    if (build && /^[\w.-]{1,80}$/.test(build)) backendBuild = build;
    diagnostics.record('http', 'request', response.status === 409 ? 'conflict' : response.ok ? 'success' : 'error',
      { ...data, status: response.status, durationMs: Math.round(performance.now() - start) }, scope, context);
    return response;
  } catch (reason) {
    diagnostics.record('http', 'request', init.signal?.aborted ? 'cancelled' : 'unknown',
      { ...data, durationMs: Math.round(performance.now() - start), reason: init.signal?.aborted ? 'caller_aborted' : 'no_response_result_unknown', error: safeError(reason) }, scope, context);
    if (init.signal?.aborted) throw reason;
    throw new ResponseUnknownError(requestId);
  }
}
