import type { AssDocument, Cue } from '../contracts/subtitles';
import { MAX_TIME_MS, validateInterval } from '../media/playback';
import { orderCues } from '../subtitle-model/cue-order';
import { DEFAULT_CUE_DURATION_MS } from './cue-defaults';

/** Commit the draft, then select the next displayed row or append an empty one. */
export function commitTiming(
  document: AssDocument, selectedId: string | null, start: number, end: number, createId: () => string,
): { document: AssDocument; selected: Cue } {
  validateInterval(start, end);
  const ordered = orderCues(document.cues);
  const index = ordered.findIndex(cue => cue.id === selectedId);
  if (ordered.length && index < 0) throw new Error('请先选择一条字幕行');

  // Choose the successor before editing: changing timing may reorder the table.
  const next = ordered[index + 1];
  if (!next && end + DEFAULT_CUE_DURATION_MS > MAX_TIME_MS) {
    throw new Error('下一条字幕的默认 2 秒时长超出支持的时间范围，请调整出点');
  }
  const current: Cue = index < 0
    ? { id: createId(), start_ms: start, end_ms: end, text: '', style_id: document.styles[0].id }
    : { ...ordered[index], start_ms: start, end_ms: end };
  const cues = index < 0 ? [current] : document.cues.map(cue => cue.id === current.id ? current : cue);
  if (next) return { document: { ...document, cues }, selected: next };

  const following: Cue = {
    id: createId(), start_ms: end, end_ms: end + DEFAULT_CUE_DURATION_MS, text: '', style_id: current.style_id,
  };
  return { document: { ...document, cues: [...cues, following] }, selected: following };
}
