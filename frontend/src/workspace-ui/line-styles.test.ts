import { expect, it } from 'vitest';
import type { AssDocument } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { createHistory, record, undo, redo, type EditState } from './edit-history';
import { lineSelection, selectedLineIds } from './line-selection';
import { assignLineStyle, selectedLineStyle } from './line-styles';

const document: AssDocument = { schema_version: 2, source: 'original', script: testScript,
  styles: [testStyle('Default'), testStyle('Other')],
  cues: ['c', 'a', 'b', 'd'].map(id => ({ id, start_ms: 0, end_ms: 1000, text: id,
    style_id: id === 'c' ? 'Other' : 'Default', source_id: `source-${id}` })) };
const initial: EditState = { document, selectedId: 'a', startText: '0:', endText: '' };

it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }])('applies to the existing selection (%j) as one undo step', modifiers => {
  const before = { ...initial, ...lineSelection(initial, 'c', ['a', 'b', 'c', 'd'], modifiers) };
  const ids = selectedLineIds(before);
  expect(selectedLineStyle(document, ids)).toBe('');
  const updated = assignLineStyle(document, ids, 'Default');
  const after = { ...before, document: updated };
  expect(selectedLineStyle(updated, ids)).toBe('Default');
  for (const [index, cue] of updated.cues.entries()) {
    expect(cue).toEqual({ ...document.cues[index], style_id: ids.includes(cue.id) ? 'Default' : document.cues[index].style_id });
    if (cue.id !== 'c') expect(cue).toBe(document.cues[index]);
  }
  expect(updated.source).toBe(document.source);
  expect(updated.styles).toBe(document.styles);
  expect(updated.script).toBe(document.script);
  const history = record(createHistory(before), after);
  expect(history.past).toHaveLength(1);
  expect(undo(history).present).toBe(before);
  expect(redo(undo(history)).present).toBe(after);
  expect(after.startText).toBe('0:');
  expect(after.endText).toBe('');
  expect(document.cues[0].style_id).toBe('Other');
});

it('updates only selected cues and preserves no-op references and redo', () => {
  const changed = assignLineStyle(document, ['a', 'b'], 'Other');
  expect(changed.cues.map(cue => cue.style_id)).toEqual(['Other', 'Other', 'Other', 'Default']);
  expect(changed.cues[0]).toBe(document.cues[0]);
  expect(changed.cues[3]).toBe(document.cues[3]);
  expect(assignLineStyle(document, [], 'Other')).toBe(document);
  expect(assignLineStyle(document, ['a', 'missing'], 'Default')).toBe(document);
  const history = undo(record(createHistory(initial), { ...initial, document: changed }));
  expect(record(history, { ...initial, document: assignLineStyle(document, ['a'], 'Default') })).toBe(history);
});

it('reports a common style for single/uniform selections, and rejects unknown style IDs', () => {
  expect(selectedLineStyle(document, ['c'])).toBe('Other');
  expect(selectedLineStyle(document, ['a', 'b'])).toBe('Default');
  expect(selectedLineStyle(document, [])).toBe('');
  expect(() => assignLineStyle(document, ['a'], 'missing')).toThrow('有效的字幕样式');
});
