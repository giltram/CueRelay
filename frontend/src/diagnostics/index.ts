import { DiagnosticRecorder } from './recorder';
import { IndexedDiagnosticStorage } from './storage';
import { safeError } from './safety';
import type { WorkspaceStatus } from './schema';
export { safeError } from './safety';
export const diagnostics = new DiagnosticRecorder(new IndexedDiagnosticStorage(), fence => { try { channel?.postMessage(fence); } catch { /* optional */ } });
let channel: BroadcastChannel | undefined;
export function startDiagnostics() {
  try {
    channel = new BroadcastChannel('cuerelay-diagnostics-identity-v1');
    diagnostics.setCoordinationAvailable(true);
    channel.onmessage = event => {
      const value = event.data;
      if (typeof value?.owner === 'string' && typeof value?.epoch === 'string') diagnostics.invalidate(value);
    };
  } catch { /* IndexedDB fence remains authoritative when channels are unavailable. */ }
  window.addEventListener('error', event => diagnostics.record('app', 'unhandled_exception', 'error', { error: safeError(event.error) }));
  window.addEventListener('unhandledrejection', event => diagnostics.record('app', 'unhandled_rejection', event.reason?.name === 'AbortError' ? 'cancelled' : 'error', { error: safeError(event.reason) }));
  window.addEventListener('pagehide', () => { void diagnostics.collect(); });
}
let workspace: { owner: number; organizationId?: number; get: () => WorkspaceStatus } | undefined;
export function provideWorkspaceStatus(owner: number, get: () => WorkspaceStatus, organizationId?: number) {
  const provider = { owner, get, organizationId }; workspace = provider;
  return () => { if (workspace === provider) workspace = undefined; };
}
export function workspaceStatus() {
  try { return workspace && diagnostics.isOwner(workspace.owner) && workspace.organizationId === diagnostics.contextSnapshot().organizationId ? workspace.get() : null; }
  catch { return null; }
}
const audio = new Map<string, { scope: number; status: string; organizationId?: number }>();
export function reportAudio(id: string, status: string) {
  audio.set(id, { scope: diagnostics.scope(), status, organizationId: diagnostics.contextSnapshot().organizationId });
  return () => { audio.delete(id); };
}
export function audioStatus() { return [...audio.values()].filter(value => value.scope === diagnostics.scope() && value.organizationId === diagnostics.contextSnapshot().organizationId).map(value => value.status); }

const ignored = new Map<string, { module: string; reason: string; count: number; scope: number; context: import('./schema').Context }>();
let ignoredTimer: ReturnType<typeof setTimeout> | undefined;
function flushIgnored() {
  clearTimeout(ignoredTimer); ignoredTimer = undefined;
  for (const value of ignored.values()) diagnostics.record(value.module, 'shortcut', 'ignored', { reason: value.reason, count: value.count }, value.scope, value.context);
  ignored.clear();
}
diagnostics.addFlusher(flushIgnored);
export function noteIgnored(module: string, reason: string) {
  const key = `${diagnostics.scope()}:${module}:${reason}`;
  const current = ignored.get(key);
  if (current) current.count++;
  else if (ignored.size < 16) ignored.set(key, { module, reason, count: 1, scope: diagnostics.scope(), context: diagnostics.contextSnapshot() });
  if (!ignoredTimer) ignoredTimer = setTimeout(flushIgnored, 2000);
}
