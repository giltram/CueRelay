import type { AssDocument, Cue } from '../contracts/subtitles';
import { MAX_TIME_MS, validateInterval } from '../media/playback';
import type { VideoFrameInterval } from '../media/video-frame';

export const INSERT_DURATION_MS = 3000;
export interface LineEditResult { document: AssDocument; selected: Cue[] }

/** Clipboard transforms cannot replace the template/styles. Reuse unchanged
 * records so no-op overwrites preserve history and the saved-document baseline. */
export function shareLineReferences(before: AssDocument, received: AssDocument): AssDocument {
  if (before.source !== received.source || JSON.stringify(before.styles) !== JSON.stringify(received.styles)
    || JSON.stringify(before.script) !== JSON.stringify(received.script)) throw new Error('粘贴不能替换 ASS 模板或样式定义');
  const previous = new Map(before.cues.map(cue => [cue.id, cue]));
  const cues = received.cues.map(cue => {
    const old = previous.get(cue.id);
    if (!old || Object.keys(old).length !== Object.keys(cue).length) return cue;
    const equal = Object.entries(old).every(([key, value]) => key === 'ass_fields'
      ? Boolean(cue.ass_fields && Object.entries(value!).every(([field, entry]) => cue.ass_fields![field as keyof typeof cue.ass_fields] === entry))
      : cue[key as keyof Cue] === value);
    return equal ? old : cue;
  });
  return cues.length === before.cues.length && cues.every((cue, index) => cue === before.cues[index]) ? before : { ...before, cues };
}

function checked(document: AssDocument, cues: Cue[], selected: Cue[]): LineEditResult {
  if (cues.length > 5000) throw new Error('字幕不能超过 5000 行');
  for (const cue of cues) validateInterval(cue.start_ms, cue.end_ms);
  return { document: { ...document, cues }, selected };
}

/** Preserve the original ASS metadata anchor through repeated duplication. */
function cloneCue(cue: Cue, createId: () => string): Cue {
  const source = cue.source_id ?? (cue.id.startsWith('source-') ? cue.id : undefined);
  return { ...cue, id: createId(), ...(source ? { source_id: source } : {}) };
}

/** Insertion order and time calculation are independent of the table's display order. */
export function insertLine(document: AssDocument, activeId: string, after: boolean, createId: () => string, frame?: VideoFrameInterval): LineEditResult {
  const index = document.cues.findIndex(cue => cue.id === activeId), active = document.cues[index];
  if (!active) throw new Error('请先选择一条字幕行');
  let start: number, end: number;
  if (frame) { start = frame.start; end = start + INSERT_DURATION_MS; }
  else if (after) {
    start = active.end_ms; end = start + INSERT_DURATION_MS;
    for (const cue of document.cues) if (cue.start_ms >= start) end = Math.min(end, cue.start_ms);
  } else {
    end = active.start_ms; start = Math.max(0, end - INSERT_DURATION_MS);
    for (const cue of document.cues) if (cue.end_ms <= end) start = Math.max(start, cue.end_ms);
  }
  if (start >= end) throw new Error('相邻时间边界之间没有可插入的时长');
  if (end > MAX_TIME_MS) throw new Error('插入字幕超出支持的时间范围');
  const cue: Cue = { id: createId(), start_ms: start, end_ms: end, text: '', style_id: active.style_id };
  const cues = [...document.cues]; cues.splice(index + Number(after), 0, cue);
  return checked(document, cues, [cue]);
}

/** Aegisub duplicates each contiguous selected block immediately after that block. */
export function duplicateLines(document: AssDocument, ids: readonly string[], createId: () => string,
  split?: { frame: VideoFrameInterval; after: boolean }): LineEditResult {
  const selected = new Set(ids), cues: Cue[] = [], copies: Cue[] = [];
  for (let index = 0; index < document.cues.length;) {
    if (!selected.has(document.cues[index].id)) { cues.push(document.cues[index++]); continue; }
    const block: Cue[] = [];
    while (index < document.cues.length && selected.has(document.cues[index].id)) {
      let original = document.cues[index++];
      let copy = cloneCue(original, createId);
      if (split) {
        const { frame, after } = split;
        if (frame.end <= original.start_ms || frame.start >= original.end_ms) {
          copy = { ...copy, start_ms: frame.start, end_ms: frame.end };
        } else {
          const boundary = after ? frame.end : frame.start;
          original = { ...original, end_ms: boundary };
          copy = { ...copy, start_ms: boundary };
        }
      }
      cues.push(original); block.push(copy); copies.push(copy);
    }
    cues.push(...block);
  }
  if (!copies.length) throw new Error('请先选择一条字幕行');
  return checked(document, cues, copies);
}

export function deleteLines(document: AssDocument, ids: readonly string[], ordered: readonly Cue[]): LineEditResult {
  const removed = new Set(ids), first = ordered.findIndex(cue => removed.has(cue.id));
  if (first < 0) throw new Error('请先选择一条字幕行');
  const next = ordered.slice(first).find(cue => !removed.has(cue.id))
    ?? ordered.slice(0, first).reverse().find(cue => !removed.has(cue.id));
  return checked(document, document.cues.filter(cue => !removed.has(cue.id)), next ? [next] : []);
}
