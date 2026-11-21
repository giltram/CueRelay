import { describe, expect, it } from 'vitest';
import type { AssDocument } from '../contracts/subtitles';
import { createHistory, record, redo, undo, type EditState } from './edit-history';
import { workspaceChanges } from './workspace-changes';

const saved = { schema_version: 2, source: '', script: {}, styles: [{ id: 'style' }], cues: [
  { id: 'a', text: 'saved', style_id: 'style', start_ms: 0, end_ms: 2000 },
] } as AssDocument;
const initial: EditState = { document: saved, selectedId: 'a', startText: '0:00:00.00', endText: '0:00:02.00' };
const changed = { ...saved, cues: [{ ...saved.cues[0], text: 'edited' }] };

describe('workspace unsaved changes', () => {
  it('treats saved content as clean even when loaded or reverted in a different object', () => {
    expect(workspaceChanges(initial, saved).unsaved).toBe(false);
    expect(workspaceChanges({ ...initial, document: structuredClone(saved) }, saved).unsaved).toBe(false);
    expect(workspaceChanges({ ...initial, document: changed }, saved).unsaved).toBe(true);
  });

  it('compares edits and undo/redo against the latest successful save rather than an ever-edited flag', () => {
    let history = record(createHistory(initial), { ...initial, document: changed });
    expect(workspaceChanges(history.present, saved).unsaved).toBe(true);
    history = undo(history);
    expect(workspaceChanges(history.present, saved).unsaved).toBe(false);
    history = redo(history);
    expect(workspaceChanges(history.present, changed).unsaved).toBe(false);
    expect(workspaceChanges(undo(history).present, changed).unsaved).toBe(true);
  });

  it('keeps timing-only edits unsaved after saving the document, including incomplete and invalid inputs', () => {
    for (const startText of ['0:00:01.00', '0:', '', 'invalid']) {
      const state = { ...initial, startText };
      const changes = workspaceChanges(state, saved);
      expect(changes.documentChanged).toBe(false);
      expect(changes.unsaved).toBe(true);
      expect(changes.timingDraft).toMatchObject({ cueId: 'a', startText });
    }
    const applied = { ...saved, cues: [{ ...saved.cues[0], start_ms: 1000 }] };
    const state = { ...initial, document: applied, startText: '0:00:01.00' };
    expect(workspaceChanges(state, saved)).toMatchObject({ unsaved: true, timingDraft: null });
    expect(workspaceChanges(state, applied).unsaved).toBe(false);
  });

  it('protects an empty local workspace time draft using its recorded unselected baseline', () => {
    const document = { ...saved, cues: [] };
    const state = { ...initial, document, selectedId: null, unselectedEndMs: 2000 };
    expect(workspaceChanges(state, document).unsaved).toBe(false);
    expect(workspaceChanges({ ...state, endText: '0:' }, document)).toMatchObject({
      documentChanged: false, unsaved: true,
      timingDraft: { cueId: null, unselectedEndMs: 2000, endText: '0:' },
    });
  });

  it('counts local imports and style/script changes without requiring a text edit', () => {
    expect(workspaceChanges(initial, { ...saved, cues: [] }).unsaved).toBe(true);
    expect(workspaceChanges({ ...initial, document: { ...saved, source: 'different source' } }, saved).unsaved).toBe(true);
    expect(workspaceChanges({ ...initial, document: { ...saved, styles: [] } }, saved).unsaved).toBe(true);
  });
});
