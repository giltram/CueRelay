import type { AssDocument } from '../contracts/subtitles';
import { withStyleSnapshot } from '../subtitle-model/style-snapshot';
import { endGroup, type EditHistory, type EditState } from './edit-history';

function documents(history: EditHistory) {
  const states = [history.present, ...history.past.flatMap(step => [step.before, step.after]),
    ...history.future.flatMap(step => [step.before, step.after])];
  return new Set(states.flatMap(state => state.document ? [state.document] : []));
}

/** Include deleted/undone cues so a future undo or redo cannot revive a missing style. */
export function historyStyleIds(history: EditHistory): string[] {
  return [...new Set([...documents(history)].flatMap(document => document.cues.map(cue => cue.style_id)))];
}

/** External definitions are a new authority, not a local undoable edit. */
export function adoptHistoryStyles(history: EditHistory, snapshot: AssDocument): EditHistory {
  const cache = new Map<AssDocument, AssDocument>();
  for (const document of documents(history)) cache.set(document, withStyleSnapshot(document, snapshot));
  const state = (value: EditState): EditState => !value.document || cache.get(value.document) === value.document
    ? value : { ...value, document: cache.get(value.document)! };
  const steps = (values: EditHistory['past']) => values.map(step => ({ before: state(step.before), after: state(step.after) }));
  return { ...endGroup(history), present: state(history.present), past: steps(history.past), future: steps(history.future) };
}
