import { useLayoutEffect, useRef, type RefObject } from 'react';
import { insertTranslation, type TextSelection } from './term-insertion';

/** Synchronous editor action: the panel never captures an async subtitle target. */
export function useTermInsertion({ cueId, text, epoch, editor, enabled, isComposing, onEdit }: {
  cueId: string | null; text: string; epoch: number; editor: RefObject<HTMLTextAreaElement | null>;
  enabled: boolean; isComposing: () => boolean; onEdit: (text: string) => void;
}) {
  const selection = useRef<TextSelection | null>(null);
  const pending = useRef<{ cueId: string; cursor: number } | null>(null);
  const currentRow = useRef(cueId);
  if (currentRow.current !== cueId) { selection.current = null; pending.current = null; currentRow.current = cueId; }
  useLayoutEffect(() => {
    const target = pending.current; pending.current = null;
    if (target && target.cueId === cueId && editor.current && enabled) {
      editor.current.focus({ preventScroll: true }); editor.current.setSelectionRange(target.cursor, target.cursor);
      selection.current = { cueId: target.cueId, start: target.cursor, end: target.cursor };
    }
  }, [text, cueId, epoch, enabled]);
  return {
    remember() {
      const input = editor.current;
      if (cueId && input) selection.current = { cueId, start: input.selectionStart, end: input.selectionEnd };
    },
    insert(translation: string) {
      if (!enabled || !cueId || isComposing()) return;
      const result = insertTranslation(text, cueId, translation, selection.current);
      pending.current = { cueId, cursor: result.cursor };
      onEdit(result.text);
      // Identical text replacement may produce no React render.
      if (result.text === text && editor.current) {
        editor.current.focus({ preventScroll: true }); editor.current.setSelectionRange(result.cursor, result.cursor); pending.current = null;
      }
    },
  };
}
