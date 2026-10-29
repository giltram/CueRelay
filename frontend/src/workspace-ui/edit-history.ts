import type { AssDocument } from '../contracts/subtitles';

/** Only local editable state. No media, persistence metadata or viewport. */
export interface EditState {
  document: AssDocument | null;
  selectedId: string | null;
  startText: string;
  endText: string;
}
export interface EditStep { before: EditState; after: EditState }
export interface EditHistory {
  present: EditState;
  past: readonly EditStep[];
  future: readonly EditStep[];
  group: string | null;
  groupBase: Pick<EditHistory, 'present' | 'past' | 'future'> | null;
  limit: number;
}
export function createHistory(present: EditState, limit = 100): EditHistory {
  return { present, past: [], future: [], group: null, groupBase: null, limit };
}
/** Input can return to its original value using a newly allocated cue. Compare
 * only the cue records when all other immutable document parts are shared. */
function sameDocument(a: AssDocument | null, b: AssDocument | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.schema_version !== b.schema_version || a.source !== b.source
    || a.script !== b.script || a.styles !== b.styles || a.cues.length !== b.cues.length) return false;
  return a.cues.every((cue, index) => {
    const other = b.cues[index];
    return cue === other || (Object.keys(cue).length === Object.keys(other).length
      && Object.entries(cue).every(([key, value]) => other[key as keyof typeof other] === value));
  });
}
export function sameEdit(a: EditState, b: EditState): boolean {
  return sameDocument(a.document, b.document) && a.selectedId === b.selectedId && a.startText === b.startText && a.endText === b.endText;
}
export function endGroup(history: EditHistory): EditHistory {
  return history.group === null ? history : { ...history, group: null, groupBase: null };
}
/** Selection is transient, but the next step captures its exact before state. */
export function navigate(history: EditHistory, present: EditState): EditHistory {
  return { ...endGroup(history), present };
}
export function record(history: EditHistory, present: EditState, group: string | null = null): EditHistory {
  if (sameEdit(history.present, present)) return history;
  const base = group !== null && history.group === group ? history.groupBase! : history;
  const before = base.present;
  const unchanged = sameEdit(before, present);
  // Retain the group's original branches until it ends. Returning to origin
  // must not consume a redo branch or evict a step at the history limit.
  return { ...history, present: unchanged ? before : present,
    past: unchanged ? base.past : [...base.past, { before, after: present }].slice(-history.limit),
    future: unchanged ? base.future : [], group,
    groupBase: group === null ? null : { present: before, past: base.past, future: base.future },
  };
}
export function undo(history: EditHistory): EditHistory {
  const step = history.past.at(-1);
  if (!step) return endGroup(history);
  return { ...history, present: step.before, past: history.past.slice(0, -1), future: [...history.future, step], group: null, groupBase: null };
}
export function redo(history: EditHistory): EditHistory {
  const step = history.future.at(-1);
  if (!step) return endGroup(history);
  return { ...history, present: step.after, past: [...history.past, step], future: history.future.slice(0, -1), group: null, groupBase: null };
}
