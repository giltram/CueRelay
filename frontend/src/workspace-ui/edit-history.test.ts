import { describe, expect, it } from 'vitest';
import type { AssDocument } from '../contracts/subtitles';
import { commitTiming } from './commit-timing';
import { deleteCue } from './delete-cue';
import { createHistory, endGroup, navigate, record, redo, undo, type EditState } from './edit-history';

const doc = { schema_version: 2, source: '', script: {}, styles: [{ id: 'style' }], cues: [
  { id: 'a', text: 'original', style_id: 'style', start_ms: 0, end_ms: 2000 },
] } as AssDocument;
const initial: EditState = { document: doc, selectedId: 'a', startText: ' 0:00:', endText: '0:00:02.00' };

describe('workspace edit history', () => {
  it('restores raw invalid drafts, selection and immutable references', () => {
    const after = { ...initial, startText: '0:00:01.00' };
    const h = record(createHistory(initial), after);
    expect(undo(h).present).toBe(initial);
    expect(redo(undo(h)).present).toBe(after);
    expect(h.present.document).toBe(doc);
  });
  it('captures transient selection/drafts before the next edit without a navigation step', () => {
    let h = record(createHistory(initial), { ...initial, endText: '0:00:04.00' });
    const selected = { ...h.present, selectedId: null, startText: 'unfinished' };
    h = navigate(h, selected);
    expect(h.past).toHaveLength(1);
    h = record(h, { ...selected, startText: 'next' });
    expect(undo(h).present).toBe(selected);
    expect(redo(undo(h)).present.startText).toBe('next');
  });
  it('redo reuses the original result after transient navigation', () => {
    const after = { ...initial, startText: 'changed' };
    const h = navigate(record(createHistory(initial), after), { ...after, selectedId: null });
    expect(redo(undo(h)).present).toBe(after);
  });
  it('coalesces a gesture and ends it explicitly; returning to origin removes its step', () => {
    let h = record(createHistory(initial), { ...initial, endText: 'first' });
    h = record(h, { ...h.present, startText: '1' }, 'drag');
    h = record(h, { ...h.present, startText: '2' }, 'drag');
    expect(h.past).toHaveLength(2);
    h = record(h, { ...h.present, startText: initial.startText }, 'drag');
    expect(h.past).toHaveLength(1);
    h = record(h, { ...h.present, startText: '3' }, 'drag');
    expect(h.past).toHaveLength(2);
    h = record(endGroup(h), { ...h.present, startText: '4' }, 'drag');
    expect(h.past).toHaveLength(3);
    expect(undo(undo(h)).present.startText).toBe(initial.startText);
  });
  it('preserves redo for no-ops and failed validation but clears it for new edits', () => {
    const h = undo(record(createHistory(initial), { ...initial, startText: 'changed' }));
    expect(record(h, { ...h.present })).toBe(h);
    expect(() => commitTiming(doc, 'a', 3000, 2000, () => 'no')).toThrow();
    expect(h.future).toHaveLength(1);
    const branch = record(h, { ...h.present, endText: 'branch' });
    expect(branch.future).toHaveLength(0);
    expect(redo(branch)).toEqual(branch);
  });
  it('a gesture returning to origin preserves redo and the full history limit', () => {
    let h = createHistory(initial, 2);
    h = record(h, { ...initial, startText: 'one' });
    h = record(h, { ...initial, startText: 'two' });
    const before = h;
    h = record(h, { ...h.present, endText: 'moving' }, 'drag');
    h = record(h, before.present, 'drag');
    expect(h.past).toBe(before.past);
    h = undo(endGroup(h));
    const branch = h;
    h = record(h, { ...h.present, endText: 'moving' }, 'drag');
    h = record(h, branch.present, 'drag');
    expect(h.future).toBe(branch.future);
  });
  it('typing back to the original text removes the group and reuses its original document', () => {
    const original = createHistory(initial);
    let h = record(original, { ...initial, document: { ...doc, cues: [{ ...doc.cues[0], text: 'original!' }] } }, 'text');
    h = record(h, { ...initial, document: { ...doc, cues: [{ ...doc.cues[0] }] } }, 'text');
    expect(h.past).toHaveLength(0);
    expect(h.present).toBe(initial);
    expect(h.present.document).toBe(doc);
  });
  it('limits history to 100 steps and shares document references', () => {
    let h = createHistory(initial);
    for (let i = 0; i < 120; i++) h = record(h, { ...h.present, endText: String(i) });
    expect(h.past).toHaveLength(100);
    expect(h.past.every(step => step.before.document === doc && step.after.document === doc)).toBe(true);
    for (let i = 0; i < 120; i++) h = undo(h);
    expect(h.present.endText).toBe('19');
  });
  it('commits/appends atomically and redoes the same generated IDs', () => {
    let ids = 0;
    const result = commitTiming(doc, 'a', 1000, 3000, () => `new-${++ids}`);
    const after = { document: result.document, selectedId: result.selected.id, startText: '0:00:03.00', endText: '0:00:05.00' };
    const h = record(createHistory(initial), after);
    expect(undo(h).present).toBe(initial);
    expect(redo(undo(h)).present).toBe(after);
    expect(ids).toBe(1);
  });
  it('restores deletion of the last cue including its draft', () => {
    const result = deleteCue(doc, 'a');
    const h = record(createHistory(initial), { document: result.document, selectedId: null, startText: '0', endText: '0' });
    expect(h.present.document?.cues).toHaveLength(0);
    expect(undo(h).present).toBe(initial);
  });
  it('reverses text/style/timing changes in order without dangling style IDs', () => {
    let h = createHistory(initial);
    const timing = { ...initial, endText: '0:00:03.00' };
    h = record(h, timing);
    const textDoc = { ...doc, cues: [{ ...doc.cues[0], text: 'new text' }] };
    const text = { ...timing, document: textDoc };
    h = record(h, text);
    const styled = { ...text, document: { ...textDoc, styles: [{ ...doc.styles[0], id: 'new-style' }], cues: [{ ...textDoc.cues[0], style_id: 'new-style' }] } };
    h = record(h, styled);
    h = record(h, { ...styled, endText: '0:00:05.00' });
    h = undo(h);
    expect(h.present).toBe(styled);
    h = undo(h);
    expect(h.present).toBe(text);
    expect(h.present.document?.cues[0].text).toBe('new text');
    h = undo(h); expect(h.present).toBe(timing);
    h = undo(h); expect(h.present).toBe(initial);
  });
  it('a new baseline discards both branches without modifying old snapshots', () => {
    const h = undo(record(createHistory(initial), { ...initial, startText: 'x' }));
    const baseline = createHistory({ ...initial, document: { ...doc, cues: [] } });
    expect(baseline.past).toHaveLength(0); expect(baseline.future).toHaveLength(0);
    expect(h.future).toHaveLength(1); expect(doc.cues).toHaveLength(1);
  });
});
