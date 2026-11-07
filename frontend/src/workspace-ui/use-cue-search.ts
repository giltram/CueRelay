import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Cue } from '../contracts/subtitles';
import { findCueMatches, navigateCueMatches, type SearchDirection } from './cue-search';

interface Options {
  cues: Cue[];
  selectedId: string | null;
  enabled: boolean;
  workspace: RefObject<HTMLElement | null>;
  onSelect: (cue: Cue) => void;
  onReveal: (cueId: string) => void;
  onShow?: () => void;
}

/** Local UI state only. Typing never calls the workspace navigation entry point. */
export function useCueSearch({ cues, selectedId, enabled, workspace, onSelect, onReveal, onShow }: Options) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const matches = useMemo(() => findCueMatches(cues, open ? query : ''), [cues, query, open]);
  const index = matches.findIndex(match => match.cueId === cursorId);
  const currentId = index < 0 ? null : cursorId;

  function focus() { input.current?.focus({ preventScroll: true }); input.current?.select(); }
  function show() {
    if (!enabled) return;
    onShow?.();
    setOpen(true);
    // A containing pane may need to become visible before an existing input can focus.
    setFocusRequest(value => value + 1);
  }
  function close() {
    setOpen(false); setCursorId(null);
    workspace.current?.focus({ preventScroll: true });
  }
  function navigate(direction: SearchDirection) {
    if (!enabled || composing.current) return;
    const cueId = navigateCueMatches(cues, matches, selectedId, currentId, direction);
    const cue = cues.find(cue => cue.id === cueId);
    if (!cue) return;
    setCursorId(cue.id);
    onSelect(cue);
    onReveal(cue.id);
    input.current?.focus({ preventScroll: true });
  }
  useEffect(() => { if (open) focus(); }, [open, focusRequest]);
  // Once a result disappears it cannot silently become current if undo restores it.
  useEffect(() => { if (cursorId && index < 0) setCursorId(null); }, [cursorId, index]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const root = workspace.current, target = event.target;
      // A freshly opened workspace may still have the page body focused.
      const withinWorkspace = root && target instanceof Element && (root.contains(target)
        || target === window.document.body || target === window.document.documentElement);
      if (!enabled || !withinWorkspace || !(target instanceof Element)
        || target.closest('dialog, [role="dialog"]') || event.defaultPrevented
        || composing.current || event.isComposing || event.keyCode === 229) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === 'KeyF') {
        event.preventDefault();
        if (!event.repeat) show();
      } else if (open && event.key === 'Escape' && !target.closest('[data-cue-qc]')) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    };
    // Capture reserves Ctrl/Cmd+F before configurable workspace timing bindings.
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  });
  return {
    open, query, input, composing, matches, currentId, navigate,
    toggle() {
      if (!enabled) return;
      if (open) close(); else show();
    },
    changeQuery(value: string) { setQuery(value); setCursorId(null); },
    status: !query ? '' : !matches.length ? '无匹配' : `${index + 1} / ${matches.length} 行`,
  };
}
