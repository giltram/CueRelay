import { describe, MessageError } from '../contracts/messages';
import type { AssDocument } from '../contracts/subtitles';
import { validateInterval } from './timing';

/** Aegisub's Concatenate follows ASS event order, including for an unsorted file. */
export function mergeCueLines(document: AssDocument, ids: readonly string[]) {
  const targets = new Set(ids);
  const selected = document.cues.filter(cue => targets.has(cue.id));
  if (selected.length !== targets.size || targets.size < 2) {
    throw new MessageError(describe('workspaceUi.selectAtLeastTwoLinesToMerge', '请选择至少两条字幕行再合并。'));
  }

  const first = selected[0];
  let end = first.end_ms;
  for (const cue of selected) {
    validateInterval(cue.start_ms, cue.end_ms);
    end = Math.max(end, cue.end_ms);
  }
  // Retain the original ID and metadata anchor; the codec resolves hidden ASS fields.
  const cue = { ...first, end_ms: end, text: selected.map(line => line.text).join(' ') };
  const cues = document.cues.flatMap(line => line === first ? [cue] : targets.has(line.id) ? [] : [line]);
  return { document: { ...document, cues }, cue };
}
