import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssDocument } from '../contracts/subtitles';
import { DraftAutosave, type DraftStatus } from './autosave';
import { draftScope, type DraftContent, type WorkspaceDraft } from './model';

const content = (text: string, baseRevision = 1): DraftContent => ({
  baseRevision, timing: null,
  document: {
    schema_version: 2, source: '', styles: [],
    script: { play_res_x: null, play_res_y: null, scaled_border_and_shadow: null },
    cues: [{ id: 'line', style_id: 'style', start_ms: 0, end_ms: 1000, text }],
  } satisfies AssDocument,
});

function setup() {
  // A commit and its delivery to the editor are separate events. Pending
  // replies make it possible to exercise edits and cleanup between them.
  const records = new Map<string, WorkspaceDraft>();
  const operations: Array<() => void> = [];
  let status: DraftStatus = 'idle';
  const enqueue = (commit: () => void) => new Promise<void>(resolve => {
    operations.push(() => { commit(); resolve(); });
  });
  const store = {
    write: (record: WorkspaceDraft) => enqueue(() => { records.set(record.id, record); }),
    remove: (id: string) => enqueue(() => { records.delete(id); }),
  };
  const autosave = new DraftAutosave(store, draftScope(1, 2, 3), 'tab', value => { status = value; });
  const commit = async () => {
    operations.shift()?.();
    await Promise.resolve();
  };
  return { autosave, records, operations, commit, status: () => status };
}

describe('workspace draft autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces edits, caps delays during typing, and flushes before navigation', async () => {
    const { autosave, records, commit, status, operations } = setup();
    for (let i = 0; i < 6; i++) {
      autosave.update(content(String(i)));
      expect(operations).toHaveLength(0);
      vi.advanceTimersByTime(500);
    }
    expect(status()).toBe('saving');
    expect(operations).toHaveLength(1);
    await commit();
    expect([...records.values()][0].document.cues[0].text).toBe('5');
    expect(status()).toBe('saved');
    autosave.update(content('before pagehide'));
    autosave.flush();
    await commit();
    expect([...records.values()][0].document.cues[0].text).toBe('before pagehide');
  });

  it('orders a confirmed save cleanup before the next edit and keeps the new revision', async () => {
    const { autosave, records, commit, status } = setup();
    autosave.update(content('sent'));
    autosave.flush();
    autosave.update(null);
    autosave.update(content('new content', 2));
    autosave.flush(); // Start the new write before receiving either earlier reply.
    await commit(); // Old write completed while new content was pending.
    expect(status()).toBe('saving');
    await commit(); // The committed server snapshot is cleaned up.
    expect(records.size).toBe(0);
    expect(status()).toBe('saving');
    await commit();
    expect([...records.values()]).toMatchObject([{ baseRevision: 2, document: { cues: [{ text: 'new content' }] } }]);
    expect(status()).toBe('saved');
  });

  it('rewrites unapplied inputs against the new base as soon as confirmation arrives', async () => {
    const { autosave, records, commit } = setup();
    const first = { ...content('text'), timing: { cueId: 'line', startText: '0:00:', endText: '0:00:01.00' } };
    autosave.update(first);
    autosave.flush();
    autosave.update({ ...first, baseRevision: 2 });
    await commit();
    await commit(); // No debounce after a revision change.
    expect([...records.values()]).toMatchObject([{ baseRevision: 2, timing: first.timing }]);
  });

  it('discards only its writable record and suppresses pending rewrites', async () => {
    const { autosave, records, commit } = setup();
    autosave.update(content('discard this'));
    autosave.flush();
    await commit();
    const own = [...records.values()][0];
    records.set('other', { ...own, id: 'other', tabId: 'other' });
    autosave.update(content('pending'));
    const discard = autosave.discard();
    await commit();
    await discard;
    vi.runAllTimers();
    autosave.flush();
    expect([...records.keys()]).toEqual(['other']);
  });

  it('keeps the last committed draft on a failed write and accepts a later edit', async () => {
    let persisted: WorkspaceDraft | undefined;
    const write = async (record: WorkspaceDraft) => {
      if (record.document.cues[0].text === 'retained input') throw new Error('quota');
      persisted = record;
    };
    const status = vi.fn();
    const autosave = new DraftAutosave({ write, remove: async () => {} }, draftScope(1), 'tab', status);
    autosave.update(content('before failure'));
    await vi.advanceTimersByTimeAsync(750);
    autosave.update(content('retained input'));
    await vi.advanceTimersByTimeAsync(750);
    expect(status).toHaveBeenLastCalledWith('failed');
    expect(persisted?.document.cues[0].text).toBe('before failure');
    autosave.update(content('next edit'));
    await vi.advanceTimersByTimeAsync(750);
    expect(status).toHaveBeenLastCalledWith('saved');
    expect(persisted?.document.cues[0].text).toBe('next edit');
  });
});
