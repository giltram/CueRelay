import { describe, expect, it } from 'vitest';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { deleteLines, duplicateLines, insertLine, shareLineReferences } from './line-edits';

const cue = (id: string, start_ms: number, end_ms: number): Cue => ({ id, start_ms, end_ms, text: id, style_id: 'Default' });
const doc = (...cues: Cue[]): AssDocument => ({ schema_version: 2, source: '', script: testScript, styles: [testStyle('Default')], cues });
function ids() { let next = 0; return () => `new-${++next}`; }

describe('Aegisub line insertions', () => {
  it('uses 3 seconds, empty text and the active style; inserts in document order', () => {
    const original = doc(cue('active', 5000, 6000));
    const before = insertLine(original, 'active', false, ids());
    expect(before.document.cues.map(c => [c.start_ms, c.end_ms])).toEqual([[2000, 5000], [5000, 6000]]);
    expect(before.selected[0]).toMatchObject({ text: '', style_id: 'Default' });
    const after = insertLine(original, 'active', true, ids());
    expect(after.document.cues.map(c => [c.start_ms, c.end_ms])).toEqual([[5000, 6000], [6000, 9000]]);
    expect(original.cues).toHaveLength(1);
  });
  it('finds nearest boundaries across all events, even in unsorted source order', () => {
    const original = doc(cue('later', 7000, 8000), cue('active', 5000, 6000), cue('earlier', 1000, 4500));
    expect(insertLine(original, 'active', false, ids()).selected[0]).toMatchObject({ start_ms: 4500, end_ms: 5000 });
    expect(insertLine(original, 'active', true, ids()).selected[0]).toMatchObject({ start_ms: 6000, end_ms: 7000 });
  });
  it('clamps before zero and rejects no gap and time-range overflow without mutation', () => {
    expect(insertLine(doc(cue('a', 1000, 2000)), 'a', false, ids()).selected[0].start_ms).toBe(0);
    for (const original of [doc(cue('a', 0, 1000)), doc(cue('p', 0, 1000), cue('a', 1000, 2000))]) {
      const snapshot = structuredClone(original);
      expect(() => insertLine(original, 'a', false, ids())).toThrow(/没有可插入/);
      expect(original).toEqual(snapshot);
    }
    expect(() => insertLine(doc(cue('a', 35997000, 35998000)), 'a', true, ids())).toThrow(/时间范围/);
  });
  it('video insertion uses frame start without shortening against neighboring cues', () => {
    const original = doc(cue('a', 1000, 2000), cue('b', 2050, 4000));
    for (const after of [false, true]) {
      const result = insertLine(original, 'a', after, ids(), { start: 1500, end: 1540 });
      expect(result.document.cues[Number(after)].id).toBe('new-1');
      expect(result.selected[0]).toMatchObject({ start_ms: 1500, end_ms: 4500 });
    }
  });
});

describe('duplicate, frame split and delete', () => {
  it('shares no-op clipboard results and preserves metadata on repeated duplication', () => {
    const original = doc({ ...cue('new-pasted', 1000, 2000), ass_fields: { Layer: '3', Name: 'actor', MarginL: '10', MarginR: '20', MarginV: '30' } });
    expect(shareLineReferences(original, structuredClone(original))).toBe(original);
    const duplicate = duplicateLines(original, ['new-pasted'], ids());
    expect(duplicate.selected[0].ass_fields).toBe(original.cues[0].ass_fields);
    const changed = structuredClone(original); changed.cues[0].text = 'changed';
    const result = shareLineReferences(original, changed);
    expect(result.styles).toBe(original.styles); expect(result.source).toBe(original.source);
    expect(result.cues[0].text).toBe('changed');
    expect(() => shareLineReferences(original, { ...changed, source: 'changed source' })).toThrow(/模板/);
  });
  it('duplicates contiguous blocks and preserves metadata through repeated duplication', () => {
    const original = doc(cue('source-10', 0, 1000), cue('b', 2000, 3000), cue('c', 4000, 5000), cue('d', 6000, 7000));
    const result = duplicateLines(original, ['source-10', 'b', 'd'], ids());
    expect(result.document.cues.map(c => c.id)).toEqual(['source-10', 'b', 'new-1', 'new-2', 'c', 'd', 'new-3']);
    expect(result.selected[0].source_id).toBe('source-10');
    expect(duplicateLines(result.document, ['new-1'], () => 'new-repeat').selected[0].source_id).toBe('source-10');
    expect(result.selected.map(c => c.text)).toEqual(['source-10', 'b', 'd']);
    expect(original.cues).toHaveLength(4);
  });
  it.each([false, true])('assigns the entire current frame to the correct half (after=%s)', after => {
    const original = doc(cue('a', 1000, 3000));
    const result = duplicateLines(original, ['a'], ids(), { frame: { start: 2000, end: 2040 }, after });
    const boundary = after ? 2040 : 2000;
    expect(result.document.cues.map(c => [c.start_ms, c.end_ms, c.text])).toEqual([[1000, boundary, 'a'], [boundary, 3000, 'a']]);
    expect(original.cues[0].end_ms).toBe(3000);
  });
  it('duplicates only the current frame when it lies outside the original interval', () => {
    const original = doc(cue('a', 1000, 2000));
    const result = duplicateLines(original, ['a'], ids(), { frame: { start: 2000, end: 2040 }, after: false });
    expect(result.document.cues[0]).toBe(original.cues[0]);
    expect(result.selected[0]).toMatchObject({ start_ms: 2000, end_ms: 2040, text: 'a' });
  });
  it('rejects a whole split batch when any half would have zero duration', () => {
    const original = doc(cue('a', 1000, 3000), cue('b', 2000, 3000));
    expect(() => duplicateLines(original, ['a', 'b'], ids(), { frame: { start: 2000, end: 2040 }, after: false })).toThrow(/零长度/);
    expect(original.cues[0].end_ms).toBe(3000);
  });
  it('deletes a set and chooses a surviving displayed successor, predecessor, or nothing', () => {
    const original = doc(cue('c', 3000, 4000), cue('a', 0, 1000), cue('b', 1000, 2000));
    const ordered = [original.cues[1], original.cues[2], original.cues[0]];
    expect(deleteLines(original, ['a', 'b'], ordered).selected[0].id).toBe('c');
    expect(deleteLines(original, ['b', 'c'], ordered).selected[0].id).toBe('a');
    expect(deleteLines(original, ['a', 'b', 'c'], ordered).selected).toEqual([]);
  });
});
