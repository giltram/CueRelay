import { useEffect, useRef, useState, type RefObject } from 'react';
import type { EditState } from './edit-history';
import { selectedLineIds } from './line-selection';
import { needsVideoFrame, type LineAction } from './line-actions';
import { deleteLines, duplicateLines, insertLine, shareLineReferences, type LineEditResult } from './line-edits';
import type { AssDocument } from '../contracts/subtitles';
import { orderCues } from '../subtitle-model/cue-order';
import { readVideoFrame } from '../media/video-frame';
import { copyAssLines, pasteAssLines, type PasteField } from '../project-data/ass-api';

interface Options {
  current: () => EditState;
  apply: (before: EditState, result: LineEditResult) => void;
  overwrite: (before: EditState, document: AssDocument, fields: PasteField[]) => void;
  active: boolean; editable: boolean;
  pending: RefObject<boolean>;
  onBusy: (value: boolean) => void;
  file: File | null; video: HTMLVideoElement | null; duration: number;
}
/** Orchestrates async clipboard/frame reads. History remains the sole state owner;
 * late results require the same snapshot and current visibility/permission. */
export function useLineCommands({ current, apply, overwrite, active, editable, pending, onBusy, file, video, duration }: Options) {
  const [over, setOver] = useState<{ state: EditState; text: string } | null>(null);
  const availability = useRef({ active, editable });
  availability.current = { active, editable };
  useEffect(() => {
    availability.current = { active, editable };
    return () => { availability.current = { active: false, editable: false }; };
  }, [active, editable]);
  useEffect(() => { if (!active || !editable) setOver(null); }, [active, editable]);
  async function lineCommand(action: LineAction) {
    if (pending.current || !availability.current.active || over) return;
    if (action !== 'copy-lines' && !availability.current.editable) throw new Error('项目只读或尚未验证本地片源。');
    const before = current(), document = before.document, ids = selectedLineIds(before);
    if (!document || (!ids.length && action !== 'paste-lines')) throw new Error('请先选择字幕行');
    const active = before.selectedId;
    const frameCommand = needsVideoFrame(action);
    if (frameCommand && (!file || !video || !duration)) throw new Error('请先加载可播放的视频');
    const seconds = video?.currentTime ?? 0;
    const stillCurrent = () => current() === before && availability.current.active
      && (action === 'copy-lines' || availability.current.editable);
    pending.current = true; onBusy(true);
    try {
      if (action === 'copy-lines' || action === 'cut-lines') {
        if (!navigator.clipboard) throw new Error('浏览器无法访问剪贴板，请使用 HTTPS 或 localhost');
        const text = copyAssLines(document, ids);
        // A rejected browser permission must not leave the conversion promise
        // unobserved if the browser declines to consume the ClipboardItem.
        void text.catch(() => {});
        // Start the browser write during the user gesture; serialization may be async.
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
          const blob = text.then(value => new Blob([value], { type: 'text/plain' }));
          void blob.catch(() => {});
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
        } else await navigator.clipboard.writeText(await text);
        if (action === 'cut-lines' && stillCurrent()) apply(before, deleteLines(document, ids, orderCues(document.cues)));
        return;
      }
      if (action === 'paste-lines' || action === 'paste-lines-over') {
        if (!navigator.clipboard) throw new Error('浏览器无法访问剪贴板，请使用 HTTPS 或 localhost');
        const text = await navigator.clipboard.readText();
        if (!text.trim()) throw new Error('剪贴板没有字幕文本');
        if (!stillCurrent()) return;
        if (action === 'paste-lines-over') { setOver({ state: before, text }); return; }
        const result = await pasteAssLines(document, text, active!, ids, null);
        if (stillCurrent()) apply(before, { document: shareLineReferences(document, result.document), selected: result.document.cues.filter(cue => result.selected_ids.includes(cue.id)) });
        return;
      }
      const frame = frameCommand ? await readVideoFrame(file!, seconds) : undefined;
      if (!stillCurrent()) return;
      const createId = () => `new-${crypto.randomUUID()}`;
      const result = action === 'duplicate-lines' ? duplicateLines(document, ids, createId)
        : action === 'split-frame-before' || action === 'split-frame-after'
          ? duplicateLines(document, ids, createId, { frame: frame!, after: action === 'split-frame-after' })
          : insertLine(document, active!, action.endsWith('after'), createId, frame);
      apply(before, result);
    } finally { pending.current = false; onBusy(false); }
  }

  async function applyPasteOver(fields: PasteField[]) {
    if (!over || pending.current || !availability.current.editable) return;
    const { state, text } = over;
    if (current() !== state || !state.document) throw new Error('字幕已变化，请重新打开粘贴覆盖');
    pending.current = true; onBusy(true);
    try {
      const result = await pasteAssLines(state.document, text, state.selectedId!, selectedLineIds(state), fields);
      if (current() !== state || !availability.current.active || !availability.current.editable) return;
      overwrite(state, shareLineReferences(state.document, result.document), fields);
      setOver(null);
    } finally { pending.current = false; onBusy(false); }
  }

  return { run: lineCommand, applyOver: applyPasteOver, over, close: () => setOver(null) };
}
