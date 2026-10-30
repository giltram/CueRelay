import { diagnosticId } from './identifier';
import { byteSize, LIMITS, type Context, type DiagnosticEvent, type EventData, type Fence, type Outcome, type StoredEvent } from './schema';
import { safeContext, safeData } from './safety';
import { FenceChanged, type DiagnosticStorage } from './storage';

const timeout = <T>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('storage_timeout')), 2000);
  promise.then(resolve, reject).finally(() => clearTimeout(timer));
});
export class DiagnosticRecorder {
  readonly tabId = diagnosticId();
  readonly sessionId = diagnosticId();
  private sequence = 0;
  private started = performance.now();
  private owner = 'pending';
  private version = 0;
  private fence?: Fence;
  private ready: Promise<void> = Promise.resolve();
  private memory: StoredEvent[] = [];
  private bytes = 0;
  private dirty = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private flushing?: Promise<void>;
  private coordinationAvailable = false;
  private isolationUnverified = false;
  private context: Context = { page: 'unknown' };
  private flushers = new Set<() => void>();
  private blocked = false;
  private storageFailed = false;
  private storageFailure: string | null = null;
  private evicted = 0;
  private truncated = 0;
  constructor(private storage: DiagnosticStorage, private notify: (fence: Fence) => void = () => {}) {}
  setCoordinationAvailable(available: boolean) { this.coordinationAvailable = available; }
  scope() { return this.version; }
  isOwner(id: number | null) { return !this.blocked && !this.isolationUnverified && this.owner === String(id ?? 'anonymous'); }
  contextSnapshot() { return this.context; }
  setContext(context: Context) { this.context = safeContext(context); }
  addFlusher(flush: () => void) { this.flushers.add(flush); return () => { this.flushers.delete(flush); }; }
  invalidate(fence: Fence) {
    if (fence.owner !== this.owner || (this.fence && fence.epoch !== this.fence.epoch)) {
      this.version++; this.blocked = true; this.memory = []; this.bytes = 0; this.dirty.clear();
    }
  }
  identify(id: number | null) {
    const owner = String(id ?? 'anonymous');
    if (this.owner === owner && !this.blocked) return this.ready;
    this.version++; const version = this.version;
    this.owner = owner; this.blocked = false; this.isolationUnverified = false; this.memory = []; this.bytes = 0; this.dirty.clear();
    this.evicted = 0; this.truncated = 0; this.storageFailure = null; this.fence = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.ready = timeout(this.storage.identify(owner, () => version === this.version)).then(fence => {
      if (version !== this.version) return;
      this.fence = fence; this.storageFailed = false;
      // Rows gathered during initialization adopt the confirmed storage generation.
      for (const row of this.memory) row.fence = fence;
      this.notify(fence);
    }).catch(() => { if (version === this.version) { this.storageFailed = true; this.isolationUnverified = !this.coordinationAvailable; this.notify({ owner, epoch: 'memory' }); } });
    return this.ready;
  }
  record(module: string, action: string, outcome: Outcome, data: EventData = {}, scope = this.version, context = this.context) {
    try {
      if (scope !== this.version || this.blocked) return;
      const safe = safeData(data);
      const event: DiagnosticEvent = { id: '', tabId: this.tabId, sessionId: this.sessionId,
        sequence: ++this.sequence, timestamp: new Date().toISOString(), elapsedMs: Math.round(performance.now() - this.started),
        context: safeContext(context), module, action, outcome, data: safe };
      event.id = `${event.timestamp}:${this.sessionId}:${String(event.sequence).padStart(10, '0')}`;
      if (JSON.stringify(safe) !== JSON.stringify(data)) { event.truncated = true; this.truncated++; }
      if (byteSize(event) > LIMITS.eventBytes) {
        event.data = { reason: 'event_size_limit' }; event.truncated = true; this.truncated++;
      }
      const row = { id: event.id, fence: this.fence ?? { owner: this.owner, epoch: 'memory' }, bytes: byteSize(event), event };
      this.memory.push(row); this.dirty.add(row.id); this.bytes += row.bytes;
      this.prune();
      if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, LIMITS.batchMs);
    } catch { this.storageFailed = true; }
  }
  private prune(expireAll = false) {
    const cutoff = Date.now() - LIMITS.ageMs;
    if (expireAll) this.memory = this.memory.filter(row => {
      if (Date.parse(row.event.timestamp) >= cutoff) return true;
      this.bytes -= row.bytes; this.dirty.delete(row.id); this.evicted++; return false;
    });
    while (this.memory.length && (this.memory.length > LIMITS.events || this.bytes > LIMITS.bytes || Date.parse(this.memory[0].event.timestamp) < cutoff)) {
      const removed = this.memory.shift()!; this.bytes -= removed.bytes; this.dirty.delete(removed.id); this.evicted++;
    }
  }
  flush() {
    if (this.flushing) return this.flushing;
    const version = this.version;
    const task = async () => {
      await this.ready;
      if (version !== this.version || this.blocked) return;
      this.prune(true);
      if (!this.fence) return;
      const incoming = this.memory.filter(row => this.dirty.has(row.id));
      try {
        const result = await timeout(this.storage.batch(this.fence, incoming));
        if (version !== this.version) return;
        this.evicted += result.evicted;
        for (const row of incoming) this.dirty.delete(row.id);
        // Merge persisted events with records produced during the asynchronous transaction.
        const rows = new Map(result.events.map(row => [row.id, row]));
        for (const row of this.memory) if (this.dirty.has(row.id)) rows.set(row.id, row);
        this.memory = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
        this.bytes = this.memory.reduce((total, row) => total + row.bytes, 0); this.prune(true);
      } catch (reason) {
        if (version !== this.version) return;
        this.storageFailure = reason instanceof Error && ['QuotaExceededError', 'DataCloneError', 'DataError', 'InvalidStateError', 'TransactionInactiveError', 'AbortError', 'UnknownError', 'Error'].includes(reason.name) ? reason.name : 'unknown';
        if (reason instanceof Error && reason.message === 'storage_timeout') this.storageFailure = 'timeout';
        if (reason instanceof FenceChanged) { this.invalidate({ owner: 'invalidated', epoch: '' }); }
        else {
          this.storageFailed = true;
          try {
            if (this.storage.check && !await timeout(this.storage.check(this.fence))) this.invalidate({ owner: 'invalidated', epoch: '' });
            else this.isolationUnverified = !this.storage.check && !this.coordinationAvailable;
          } catch { this.isolationUnverified = !this.coordinationAvailable; }
        }
      }
    };
    this.flushing = task().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }
  async collect() {
    for (const flush of this.flushers) { try { flush(); } catch { this.storageFailed = true; } }
    await this.flush();
    // A pre-existing batch may have started before the export's input flush.
    // Drain its newly queued rows once; never loop indefinitely while users edit.
    if (this.dirty.size && this.fence && !this.storageFailed && !this.blocked) await this.flush();
    this.prune(true);
    const organizationId = this.context.organizationId;
    if (!this.fence) this.storageFailed = true;
    return { events: this.memory.filter(row => (row.event.context.organizationId === undefined || row.event.context.organizationId === organizationId) && (!this.isolationUnverified || row.event.module === 'http' || row.event.module === 'app')).map(row => this.isolationUnverified ? { ...row.event, context: { page: row.event.context.page } } : row.event),
      coverage: { storage: this.storageFailed ? 'memory_fallback' : 'indexeddb', storageFailure: this.storageFailure, accountIsolated: !this.blocked && !this.isolationUnverified,
        evicted: this.evicted, truncated: this.truncated, limits: LIMITS } };
  }
}
