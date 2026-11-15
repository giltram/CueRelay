import { expect, it } from 'vitest';
import type { AssDocument } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { createHistory, record, redo, undo, type EditState } from './edit-history';
import { adoptHistoryStyles, historyStyleIds } from './history-styles';

const document: AssDocument = { schema_version: 2, source: 'source', script: testScript,
  styles: [testStyle('Default'), testStyle('Other')],
  cues: [{ id: 'a', text: 'original', style_id: 'Default', start_ms: 0, end_ms: 2000 }] };
const initial: EditState = { document, selectedId: 'a', selectedIds: ['a'], selectionAnchorId: 'a', startText: '0:00:', endText: '0:00:02.00' };

it('adopts styles throughout undo/redo without adding steps, clearing branches or changing drafts', () => {
  const changed = { ...initial, document: { ...document, cues: [{ ...document.cues[0], text: 'edited' }] } };
  let history = record(createHistory(initial), changed);
  history = record(history, { ...changed, endText: 'unfinished' });
  history = undo(history);
  const snapshot = structuredClone(document);
  snapshot.styles[0].fields.Fontsize = '55';
  snapshot.script.play_res_x = 1280;
  const adopted = adoptHistoryStyles(history, snapshot);
  expect(adopted.past).toHaveLength(1);
  expect(adopted.future).toHaveLength(1);
  expect(adopted.present.document?.cues).toBe(changed.document.cues);
  expect(adopted.present.selectedIds).toBe(initial.selectedIds);
  expect(adopted.present.startText).toBe('0:00:');
  expect(adopted.present.document?.styles).toBe(snapshot.styles);
  expect(adopted.present.document?.script).toBe(snapshot.script);
  const savedDocument = adopted.present.document;
  expect(undo(adopted).present.document?.cues[0].text).toBe('original');
  expect(undo(adopted).present.document?.styles).toBe(snapshot.styles);
  expect(redo(undo(adopted)).present.document).toBe(savedDocument);
  expect(redo(adopted).present.document).toBe(savedDocument); // Draft-only step shared the original document.
  expect(redo(adopted).present.endText).toBe('unfinished');
  expect(document.styles[0].fields.Fontsize).toBe('28');
  expect(history.present).toBe(changed);
});

it('checks styles in deleted and undone cues, not just the current document', () => {
  const other = { ...initial, document: { ...document, cues: [{ ...document.cues[0], style_id: 'Other' }] } };
  const deleted = { ...initial, document: { ...document, cues: [] }, selectedId: null };
  const history = record(record(createHistory(initial), other), deleted);
  expect(historyStyleIds(history).sort()).toEqual(['Default', 'Other']);
  const futureOnly = undo(record(createHistory(initial), other));
  expect(historyStyleIds(futureOnly).sort()).toEqual(['Default', 'Other']);
});

it('ends an active group while retaining the applied step and its original cue snapshots', () => {
  const history = record(createHistory(initial), { ...initial, startText: 'changed' }, 'typing');
  const adopted = adoptHistoryStyles(history, structuredClone(document));
  expect(adopted.group).toBeNull();
  expect(adopted.groupBase).toBeNull();
  expect(adopted.past).toHaveLength(1);
  expect(undo(adopted).present.startText).toBe(initial.startText);
  expect(adopted.present.document).toBe(adopted.past[0].before.document);
});

it('keeps null states and reuses documents already on the authoritative definitions', () => {
  const empty = { ...initial, document: null };
  const history = record(createHistory(empty), initial);
  const adopted = adoptHistoryStyles(history, document);
  expect(adopted.present).toBe(initial);
  expect(undo(adopted).present).toBe(empty);
  expect(historyStyleIds(createHistory(empty))).toEqual([]);
});
