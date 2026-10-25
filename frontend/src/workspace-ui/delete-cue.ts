import type { AssDocument, Cue } from '../contracts/subtitles';
import { orderCues } from '../subtitle-model/cue-order';

/** Delete the selected row, preferring its displayed successor, then predecessor. */
export function deleteCue(document: AssDocument, selectedId: string): { document: AssDocument; selected: Cue | null } {
  const ordered = orderCues(document.cues);
  const index = ordered.findIndex(cue => cue.id === selectedId);
  if (index < 0) throw new Error('请先选择一条字幕行');
  return {
    document: { ...document, cues: document.cues.filter(cue => cue.id !== selectedId) },
    selected: ordered[index + 1] ?? ordered[index - 1] ?? null,
  };
}
