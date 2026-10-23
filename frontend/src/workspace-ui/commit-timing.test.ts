import { describe, expect, it, vi } from 'vitest';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { MAX_TIME_MS } from '../media/playback';
import { commitTiming } from './commit-timing';
import { orderCues } from './cue-order';

const cue = (id: string, start: number, style = 'Default'): Cue => ({
  id, start_ms: start, end_ms: start + 1000, text: `text-${id}`, style,
});
const documentWith = (...cues: Cue[]): AssDocument => ({ source: 'original ASS template', styles: ['Default', 'Emphasis'], cues });
const ids = () => { let id = 0; return () => `new-${++id}`; };

describe('commit timing and advance', () => {
  it('starts an empty document from the draft and prepares a contiguous two-second row', () => {
    const original = documentWith();
    const result = commitTiming(original, null, 1200, 3400, ids());
    expect(result.document).toEqual({ ...original, cues: [
      { id: 'new-1', start_ms: 1200, end_ms: 3400, text: '', style: 'Default' },
      { id: 'new-2', start_ms: 3400, end_ms: 5400, text: '', style: 'Default' },
    ] });
    expect(result.selected).toBe(result.document.cues[1]);
    expect(original.cues).toEqual([]);
  });

  it('updates the current row and selects an existing successor without changing it', () => {
    const first = cue('first', 1000, 'Emphasis');
    const next = cue('next', 4000);
    const original = documentWith(first, next);
    const createId = vi.fn();
    const result = commitTiming(original, first.id, 1800, 2800, createId);
    expect(result.document.cues).toEqual([{ ...first, start_ms: 1800, end_ms: 2800 }, next]);
    expect(result.selected).toBe(next);
    expect(result.document.source).toBe(original.source);
    expect(result.document.styles).toBe(original.styles);
    expect(original.cues).toEqual([first, next]);
    expect(createId).not.toHaveBeenCalled();
  });

  it('appends only at the end, inheriting style while keeping the new text empty', () => {
    const last = cue('last', 4000, 'Emphasis');
    const createId = ids();
    const result = commitTiming(documentWith(last), last.id, 4560, 7890, createId);
    expect(result.document.cues[0]).toEqual({ ...last, start_ms: 4560, end_ms: 7890 });
    expect(result.selected).toEqual({ id: 'new-1', start_ms: 7890, end_ms: 9890, style: 'Emphasis', text: '' });
    const following = commitTiming(result.document, result.selected.id, 7890, 10500, createId);
    expect(following.selected).toMatchObject({ start_ms: 10500, end_ms: 12500, style: 'Emphasis', text: '' });
  });

  it('shares stable table order, choosing the next row before timing edits reorder it', () => {
    const first = cue('first', 1000);
    const tied = cue('tied', 1000);
    const shorter = { ...cue('shorter', 1000), end_ms: 1500 };
    const last = cue('last', 4000);
    const original = documentWith(last, first, tied, shorter);
    expect(orderCues(original.cues).map(row => row.id)).toEqual(['shorter', 'first', 'tied', 'last']);
    const result = commitTiming(original, first.id, 6000, 7000, ids());
    expect(result.selected).toBe(tied);
    expect(result.document.cues.map(row => row.id)).toEqual(['last', 'first', 'tied', 'shorter']);
  });

  it.each([[2000, 2000], [3000, 2000], [-10, 2000], [1, 2000], [0, MAX_TIME_MS + 10]])(
    'rejects invalid drafts (%s, %s) without editing the document or allocating IDs', (start, end) => {
      const original = documentWith(cue('first', 1000));
      const before = structuredClone(original);
      const createId = vi.fn();
      expect(() => commitTiming(original, 'first', start, end, createId)).toThrow();
      expect(original).toEqual(before);
      expect(createId).not.toHaveBeenCalled();
    },
  );

  it.each([null, 'missing'])('requires a selected row in a nonempty document (%s)', selectedId => {
    expect(() => commitTiming(documentWith(cue('first', 1000)), selectedId, 1000, 2000, ids())).toThrow('请先选择');
  });

  it('enforces the supported range atomically without shortening the default duration', () => {
    const original = documentWith(cue('last', 1000));
    const createId = vi.fn();
    expect(() => commitTiming(original, 'last', 1000, MAX_TIME_MS - 1990, createId)).toThrow('默认 2 秒');
    expect(original.cues[0].end_ms).toBe(2000);
    expect(createId).not.toHaveBeenCalled();
    const result = commitTiming(original, 'last', 1000, MAX_TIME_MS - 2000, ids());
    expect(result.selected.end_ms).toBe(MAX_TIME_MS);
    const next = cue('next', 5000);
    expect(commitTiming(documentWith(original.cues[0], next), 'last', 1000, MAX_TIME_MS, ids()).selected).toBe(next);
  });
});
