import { describe, MessageError } from "../contracts/messages";
import type { AssDocument } from '../contracts/subtitles';

/** Empty means mixed styles or no selection; it is never a real style ID. */
export function selectedLineStyle(document: AssDocument, ids: readonly string[]): string {
  const selected = new Set(ids);
  const styles = new Set(document.cues.filter(cue => selected.has(cue.id)).map(cue => cue.style_id));
  return styles.size === 1 ? [...styles][0] : '';
}

/** Only replace changed cues, preserving the document reference for a no-op. */
export function assignLineStyle(document: AssDocument, ids: readonly string[], styleId: string): AssDocument {
  if (!document.styles.some(style => style.id === styleId)) throw new MessageError(describe("workspaceUi.selectAValidSubtitleStyle", "请选择有效的字幕样式"));
  const selected = new Set(ids);
  const cues = document.cues.map(cue => selected.has(cue.id) && cue.style_id !== styleId ? { ...cue, style_id: styleId } : cue);
  return cues.every((cue, index) => cue === document.cues[index]) ? document : { ...document, cues };
}
