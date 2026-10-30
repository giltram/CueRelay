/** Stable v1 wire format. Only explicit, bounded projections cross this boundary. */
export const FORMAT_VERSION = 1;
export const LIMITS = { events: 1500, eventBytes: 16 * 1024, bytes: 2 * 1024 * 1024, ageMs: 24 * 60 * 60 * 1000, batchMs: 2000 };
export type Outcome = 'start' | 'success' | 'error' | 'conflict' | 'cancelled' | 'stale' | 'ignored' | 'unknown' | 'changed';
export interface Context { page: string; organizationId?: number; projectId?: number }
export interface EventData {
  operationId?: string; requestId?: string; method?: string; route?: string; status?: number; durationMs?: number;
  revision?: number; reason?: string; count?: number; cueId?: string;
  before?: CueFields; after?: CueFields; draftBefore?: TimeDraft; draftAfter?: TimeDraft;
  styleId?: string; fields?: Record<string, string | number | boolean | null>;
  error?: SafeError;
}
export interface CueFields { text: string; start_ms: number; end_ms: number; style_id: string }
export interface TimeDraft { startText: string; endText: string; selectedId: string | null }
export interface SafeError { type: string; message: string; stack: string[] }
export interface DiagnosticEvent {
  id: string; tabId: string; sessionId: string; sequence: number; timestamp: string; elapsedMs: number;
  context: Context; module: string; action: string; outcome: Outcome; data: EventData; truncated?: boolean;
}
export interface WorkspaceStatus {
  projectId: number | null; visible: boolean;
  unsaved: boolean | null; revision: number | null; editable: boolean;
  video: { loaded: boolean; verified: boolean; readyState: number | null; networkState: number | null;
    duration: number | null; width: number | null; height: number | null; errorCode: number | null };
  audition: string; preview: string;
}
export interface Fence { owner: string; epoch: string }
export interface StoredEvent { id: string; fence: Fence; bytes: number; event: DiagnosticEvent }
export const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
