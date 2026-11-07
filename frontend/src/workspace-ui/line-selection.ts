import type { EditState } from './edit-history';

export interface SelectionModifiers { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
export function selectedLineIds(state: EditState): string[] {
  const existing = new Set(state.document?.cues.map(cue => cue.id));
  return [...(state.selectedIds ?? (state.selectedId ? [state.selectedId] : []))].filter(id => existing.has(id));
}

/** Shift ranges follow the visible chronological order; document order stays intact. */
export function lineSelection(state: EditState, id: string, orderedIds: string[], modifiers: SelectionModifiers = {}) {
  const selected = selectedLineIds(state), anchor = state.selectionAnchorId ?? state.selectedId ?? id;
  if (modifiers.shiftKey && orderedIds.includes(anchor)) {
    const a = orderedIds.indexOf(anchor), b = orderedIds.indexOf(id);
    const range = orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { selectedId: id, selectedIds: modifiers.ctrlKey || modifiers.metaKey ? [...new Set([...selected, ...range])] : range, selectionAnchorId: anchor };
  }
  if (modifiers.ctrlKey || modifiers.metaKey) {
    const ids = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    return { selectedId: ids.includes(id) ? id : ids.at(-1) ?? null, selectedIds: ids, selectionAnchorId: id };
  }
  return { selectedId: id, selectedIds: [id], selectionAnchorId: id };
}
