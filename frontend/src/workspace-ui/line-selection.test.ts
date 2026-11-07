import { expect, it } from 'vitest';
import { createHistory, record, undo, redo, type EditState } from './edit-history';
import { lineSelection, selectedLineIds } from './line-selection';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';

const state: EditState = { document: { schema_version: 2, source: '', script: testScript, styles: [testStyle('Default')], cues:
  ['d', 'a', 'c', 'b'].map(id => ({ id, start_ms: 0, end_ms: 1000, text: id, style_id: 'Default' })) },
  selectedId: 'b', startText: '0:', endText: '0:00:01.00' };
const ordered = ['a', 'b', 'c', 'd'];
it('toggles multi-selection and uses a stable shift anchor in visible order', () => {
  const multi = { ...state, ...lineSelection(state, 'd', ordered, { ctrlKey: true }) };
  expect(selectedLineIds(multi)).toEqual(['b', 'd']);
  const range = { ...multi, ...lineSelection(multi, 'a', ordered, { shiftKey: true }) };
  expect(selectedLineIds(range)).toEqual(ordered);
  expect(lineSelection(range, 'c', ordered, { shiftKey: true }).selectedIds).toEqual(['c', 'd']);
  expect(lineSelection(multi, 'd', ordered, { metaKey: true })).toMatchObject({ selectedId: 'b', selectedIds: ['b'] });
  expect(lineSelection(state, 'b', ordered, { ctrlKey: true }).selectedId).toBeNull();
});
it('restores the entire selection, active row, anchor and raw timing draft with history', () => {
  const before = { ...state, selectedIds: ['b', 'd'], selectionAnchorId: 'd' };
  const after = { ...state, selectedId: 'a', selectedIds: ['a'], selectionAnchorId: 'a', startText: '0:00:00.00' };
  const history = record(createHistory(before), after);
  expect(undo(history).present).toBe(before);
  expect(redo(undo(history)).present).toBe(after);
});
