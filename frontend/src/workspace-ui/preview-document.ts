import { describe } from "../contracts/messages";
import type { AssDocument } from '../contracts/subtitles';
import { parseTime, validateInterval } from '../media/playback';

/** Project a valid timing draft for rendering; never commit it to the editor. */
export function previewDocument(document: AssDocument | null, selectedId: string | null, start: string, end: string) {
  if (!document || !selectedId || !document.cues.some(cue => cue.id === selectedId)) return { document };
  try {
    const start_ms = parseTime(start), end_ms = parseTime(end);
    validateInterval(start_ms, end_ms);
    const cue = document.cues.find(cue => cue.id === selectedId)!;
    if (cue.start_ms === start_ms && cue.end_ms === end_ms) return { document };
    return { document: { ...document, cues: document.cues.map(cue => cue.id === selectedId ? { ...cue, start_ms, end_ms } : cue) } };
  } catch {
    return { document, warning: describe("workspaceUi.invalidTimeDraftPreviewUsesTheOriginalLine", "时间草稿无效，预览使用字幕行原有时间。") };
  }
}
