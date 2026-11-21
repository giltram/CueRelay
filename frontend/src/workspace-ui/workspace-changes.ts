import type { AssDocument, Cue } from '../contracts/subtitles';
import type { TimingDraft } from '../workspace-drafts/model';
import { formatTime } from '../media/playback';
import { sameSnapshotValue } from '../subtitle-model/snapshot-equality';
import type { EditState } from './edit-history';

/** Raw inputs remain unsaved until applied, including incomplete/invalid times. */
export function unappliedTiming(state: EditState, cue?: Cue): TimingDraft | null {
  const unselectedEndMs = state.unselectedEndMs ?? 0;
  const start = formatTime(cue?.start_ms ?? 0);
  const end = formatTime(cue?.end_ms ?? unselectedEndMs);
  if (state.startText === start && state.endText === end) return null;
  return { cueId: state.selectedId, startText: state.startText, endText: state.endText,
    ...(cue ? {} : { unselectedEndMs }) };
}

/** Shared by navigation protection, recoverable drafts, QC and diagnostics. */
export function workspaceChanges(state: EditState, baseline: AssDocument | null | undefined) {
  const documentChanged = !sameSnapshotValue(state.document, baseline);
  const timingDraft = state.document
    ? unappliedTiming(state, state.document.cues.find(cue => cue.id === state.selectedId)) : null;
  return { documentChanged, timingDraft, unsaved: documentChanged || timingDraft !== null };
}
