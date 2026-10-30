import type { Context, Outcome } from './schema';
import { diagnostics, safeError } from './index';
const conflicts = new Set(['revision_conflict', 'project_conflict', 'project_archived', 'style_conflict', 'template_conflict', 'account_changed']);
/** Normal control flow is distinguishable from a fault without exporting arbitrary messages. */
export function failureOutcome(reason: unknown): Outcome {
  const value = reason as { name?: string; code?: string } | null;
  if (value?.name === 'AbortError') return 'cancelled';
  if (value?.code === 'request_superseded') return 'stale';
  if (conflicts.has(value?.code ?? '')) return 'conflict';
  if (value?.code === 'response_unknown') return 'unknown';
  return 'error';
}
interface DiagnosticOrigin { scope: number; context: Context }
/** Capture before starting an operation, never when its asynchronous result arrives. */
export function captureDiagnosticOrigin(): DiagnosticOrigin {
  return { scope: diagnostics.scope(), context: { ...diagnostics.contextSnapshot() } };
}
export function reportFailure(module: string, action: string, reason: unknown, origin: DiagnosticOrigin, operationId?: string) {
  try {
    const requestId = (reason as { requestId?: string })?.requestId;
    diagnostics.record(module, action, failureOutcome(reason), { error: safeError(reason), operationId,
      ...(typeof requestId === 'string' && /^[\da-f-]{36}$/i.test(requestId) ? { requestId } : {}) }, origin.scope, origin.context);
  } catch { /* Do not turn reporting failures into unhandled errors. */ }
}
