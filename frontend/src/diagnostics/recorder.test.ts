import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticRecorder } from './recorder';
import { byteSize, LIMITS, type Fence, type StoredEvent } from './schema';
import { FenceChanged, type DiagnosticStorage } from './storage';
import { safeData, safeError, safeRoute, safeText } from './safety';
class MemoryStorage implements DiagnosticStorage {
  active: Fence = { owner: 'pending', epoch: '' };
  rows: StoredEvent[] = [];
  async identify(owner: string) {
    if (owner !== this.active.owner) { this.active = { owner, epoch: crypto.randomUUID() }; this.rows = []; }
    return this.active;
  }
  async check(fence: Fence) { return fence === this.active; }
  async batch(fence: Fence, events: StoredEvent[]) {
    if (fence !== this.active) throw new FenceChanged();
    this.rows = [...new Map([...this.rows, ...events].map(row => [row.id, row])).values()];
    return { events: this.rows, evicted: 0 };
  }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('bounded diagnostics and identity isolation', () => {
  it('automatically persists after initial identification and account switches cancel a pending batch', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage(), recorder = new DiagnosticRecorder(storage);
    const batch = vi.spyOn(storage, 'batch');
    for (const owner of [1, 2]) {
      recorder.record('http', 'request', 'start');
      await recorder.identify(owner);
      recorder.record('editor', 'edit', 'changed', { reason: `owner-${owner}` });
      await vi.advanceTimersByTimeAsync(LIMITS.batchMs);
      expect(batch).toHaveBeenCalledTimes(owner);
      expect(storage.rows.map(row => row.event.data.reason)).toEqual([`owner-${owner}`]);
    }
  });
  it('retains bounded records across recorder refresh, preserves per-source sequence', async () => {
    const storage = new MemoryStorage(), first = new DiagnosticRecorder(storage);
    await first.identify(1); first.record('editor', 'save', 'start', { revision: 4 }); await first.flush();
    const refreshed = new DiagnosticRecorder(storage); await refreshed.identify(1);
    const result = await refreshed.collect();
    expect(result.events).toHaveLength(1); expect(result.events[0].sequence).toBe(1);
    expect(result.events[0].sessionId).not.toBe(refreshed.sessionId);
  });
  it('limits count, size, total bytes and lifetime while marking omissions', async () => {
    const unavailable: DiagnosticStorage = { identify: async () => { throw Error(); }, batch: async () => { throw Error(); } };
    const recorder = new DiagnosticRecorder(unavailable); recorder.setCoordinationAvailable(true); await recorder.identify(1);
    for (let i = 0; i < 1600; i++) recorder.record('editor', 'edit', 'changed', { after: { text: '中'.repeat(9000), start_ms: 0, end_ms: 1000, style_id: 's' } });
    const result = await recorder.collect();
    expect(result.events.length).toBeLessThanOrEqual(LIMITS.events);
    expect(result.events.every(event => byteSize(event) <= LIMITS.eventBytes)).toBe(true);
    expect(result.events.reduce((sum, event) => sum + byteSize(event), 0)).toBeLessThanOrEqual(LIMITS.bytes);
    expect(result.coverage.evicted).toBeGreaterThan(0); expect(result.coverage.truncated).toBeGreaterThan(0);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + LIMITS.ageMs + 1);
    expect((await recorder.collect()).events).toHaveLength(0);
  });
  it('old tabs cannot export, persist or reintroduce old-account text after a switch even without broadcast', async () => {
    const storage = new MemoryStorage(), oldTab = new DiagnosticRecorder(storage), newTab = new DiagnosticRecorder(storage);
    await oldTab.identify(1); const scope = oldTab.scope();
    oldTab.record('editor', 'edit', 'changed', { before: { text: 'old-account', start_ms: 0, end_ms: 1, style_id: 's' } }); await oldTab.flush();
    await newTab.identify(2); newTab.record('editor', 'edit', 'changed', { reason: 'new-account' }); await newTab.flush();
    const old = await oldTab.collect(); expect(old.events).toHaveLength(0); expect(old.coverage.accountIsolated).toBe(false);
    oldTab.record('http', 'request', 'success', {}, scope);
    expect((await oldTab.collect()).events).toHaveLength(0);
    expect(JSON.stringify(await newTab.collect())).not.toContain('old-account');
  });
  it('ignores old asynchronous results and exports only current organization', async () => {
    const recorder = new DiagnosticRecorder(new MemoryStorage()); await recorder.identify(1);
    const oldScope = recorder.scope(); await recorder.identify(2);
    recorder.record('editor', 'late', 'changed', { reason: 'secret' }, oldScope);
    recorder.setContext({ page: 'project', organizationId: 1 }); recorder.record('editor', 'edit', 'changed', { reason: 'org-one' });
    recorder.setContext({ page: 'project', organizationId: 2 }); recorder.record('editor', 'edit', 'changed', { reason: 'org-two' });
    const serialized = JSON.stringify(await recorder.collect()); expect(serialized).not.toContain('secret'); expect(serialized).not.toContain('org-one'); expect(serialized).toContain('org-two');
  });
  it('storage and serialization failures never escape record or erase usable memory', async () => {
    const storage = new MemoryStorage(), recorder = new DiagnosticRecorder(storage); await recorder.identify(1);
    vi.spyOn(storage, 'batch').mockRejectedValue(Error('quota'));
    recorder.record('editor', 'save', 'start');
    const cyclic = {} as { reason: string }; Object.defineProperty(cyclic, 'reason', { get() { throw Error('getter'); } });
    expect(() => recorder.record('editor', 'unsafe', 'error', cyclic)).not.toThrow();
    const result = await recorder.collect(); expect(result.events).toHaveLength(1); expect(result.coverage.storage).toBe('memory_fallback');
  });
});
describe('explicit safety projection', () => {
  it('discards unknown fields, payloads and raw errors, strips URL queries and paths', () => {
    const error = Error('totally-unlabelled-password /Users/alice/private.mp4 Authorization=secret');
    error.stack += '\n at fn (http://localhost:5173/src/media/playback.ts:2:4)';
    const safe = safeData({ before: { text: '实际字幕', start_ms: 0, end_ms: 1, style_id: 's' }, password: 'private-password', headers: { cookie: 'private-session' }, error: safeError(error) } as never);
    const serialized = JSON.stringify(safe);
    expect(serialized).toContain('实际字幕'); expect(serialized).toContain('src/media/playback.ts:2:4');
    for (const value of ['totally-unlabelled-password', 'private.mp4', 'private-password', 'private-session', 'Authorization=secret']) expect(serialized).not.toContain(value);
    expect(safeRoute('/api/organizations/12/projects/34?search=private')).toBe('/api/organizations/:id/projects/:id');
    expect(safeRoute('/evil/private.mp4?password=x')).toBe('other');
    expect(safeText('password=secret token=lease API_key=key Bearer abc /Users/alice/private.mp4')).not.toMatch(/secret|lease|=key|abc|private.mp4/);
  });
});
it('hides account content if both persistence and cross-tab coordination are unavailable', async () => {
  const recorder = new DiagnosticRecorder({ identify: async () => { throw Error(); }, batch: async () => { throw Error(); } });
  await recorder.identify(1);
  recorder.record('editor', 'edit', 'changed', { after: { text: 'private-account-text', start_ms: 0, end_ms: 1, style_id: 's' } });
  recorder.record('http', 'request', 'unknown', { reason: 'no_response_result_unknown' });
  const result = await recorder.collect();
  expect(result.coverage.accountIsolated).toBe(false); expect(recorder.isOwner(1)).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private-account-text');
  expect(result.events.some(event => event.outcome === 'unknown')).toBe(true);
});
it('export drains edits queued after an already-running persistence batch', async () => {
  const storage = new MemoryStorage(), recorder = new DiagnosticRecorder(storage); await recorder.identify(1);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const batch = storage.batch.bind(storage);
  vi.spyOn(storage, 'batch').mockImplementationOnce(async (...args) => { started(); await gate; return batch(...args); });
  recorder.record('editor', 'edit', 'changed', { reason: 'before_batch' });
  const writing = recorder.flush(); await entered;
  recorder.record('editor', 'edit', 'changed', { reason: 'during_batch' });
  const exporting = recorder.collect(); release(); await writing; await exporting;
  const refreshed = new DiagnosticRecorder(storage); await refreshed.identify(1);
  expect((await refreshed.collect()).events.some(event => event.data.reason === 'during_batch')).toBe(true);
});
it('expires old rows even if a wall-clock change placed them after newer rows', async () => {
  vi.useFakeTimers(); const now = Date.now();
  const recorder = new DiagnosticRecorder({ identify: async () => { throw Error(); }, batch: async () => { throw Error(); } });
  recorder.setCoordinationAvailable(true); await recorder.identify(1);
  recorder.record('editor', 'edit', 'changed', { reason: 'newer' });
  vi.setSystemTime(now - 2 * LIMITS.ageMs); recorder.record('editor', 'edit', 'changed', { reason: 'expired' });
  vi.setSystemTime(now);
  const result = await recorder.collect();
  expect(result.events.map(event => event.data.reason)).toEqual(['newer']);
});
