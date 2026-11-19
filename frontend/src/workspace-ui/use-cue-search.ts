import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Cue } from '../contracts/subtitles';
import { currentOccurrence, findCueMatches, navigateCueMatches, type SearchCursor, type SearchDirection } from './cue-search';
import type { ReplaceCueRequest, ReplaceFeedback } from './cue-replacement';

interface Options {
  cues: Cue[];
  selectedId: string | null;
  epoch: number;
  enabled: boolean;
  editable: boolean;
  workspace: RefObject<HTMLElement | null>;
  onSelect: (cue: Cue) => void;
  onReveal: (cueId: string) => void;
  onReplace: (request: ReplaceCueRequest, signal: AbortSignal) => Promise<ReplaceFeedback>;
  onShow?: () => void;
}

/** Local UI state only. Typing and replacing never call workspace navigation. */
export function useCueSearch({ cues, selectedId, epoch, enabled, editable, workspace, onSelect, onReveal, onReplace, onShow }: Options) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [cursor, setCursor] = useState<(SearchCursor & { epoch: number }) | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<ReplaceFeedback | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const replacementInput = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const matches = useMemo(() => findCueMatches(cues, open ? query : ''), [cues, query, open]);
  const current = useMemo(() => currentOccurrence(matches, cursor?.epoch === epoch ? cursor : null), [matches, cursor, epoch]);
  const count = useMemo(() => matches.reduce((total, row) => total + row.occurrences.length, 0), [matches]);
  const position = current ? matches.slice(0, current.row).reduce((total, row) => total + row.occurrences.length, 0) + current.position + 1 : 0;

  function focus() { input.current?.focus({ preventScroll: true }); input.current?.select(); }
  function show() {
    if (!enabled) return;
    onShow?.();
    setOpen(true);
    setFocusRequest(value => value + 1);
  }
  function cancelReplace() {
    operation.current?.abort();
    operation.current = null;
  }
  function close() {
    cancelReplace(); setPending(false); setFeedback(null); composing.current = false;
    setOpen(false); setExpanded(false); setCursor(null);
    workspace.current?.focus({ preventScroll: true });
  }
  function navigate(direction: SearchDirection) {
    if (!enabled || composing.current || operation.current) return;
    const next = navigateCueMatches(cues, matches, selectedId, current ? cursor : null, direction);
    const cue = next && cues.find(cue => cue.id === next.cueId);
    if (!next || !cue) return;
    setCursor({ ...next, epoch });
    setFeedback(null);
    onSelect(cue);
    onReveal(cue.id);
    input.current?.focus({ preventScroll: true });
  }
  async function replace(all: boolean) {
    if (!enabled || !editable || !expanded || composing.current || operation.current || !count) return;
    const target = all ? 'all' : current ? cursor : null;
    if (!target) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true); setFeedback(null);
    try {
      const result = await onReplace({ query, replacement, target }, controller.signal);
      if (controller.signal.aborted) return;
      if ('count' in result && result.count) setCursor(null);
      setFeedback(result);
    } finally {
      if (operation.current === controller) { operation.current = null; setPending(false); }
    }
  }

  useEffect(() => { if (open) focus(); }, [open, focusRequest]);
  useEffect(() => { if (expanded) replacementInput.current?.focus({ preventScroll: true }); }, [expanded]);
  // A cursor invalidated by an edit cannot silently reappear when undo restores the row.
  useEffect(() => { if (cursor && !current) setCursor(null); }, [cursor, current]);
  useLayoutEffect(() => {
    if (!enabled || !editable) { cancelReplace(); setPending(false); composing.current = false; }
    return cancelReplace;
  }, [enabled, editable]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const root = workspace.current, target = event.target;
      // A freshly opened workspace may still have the page body focused.
      const withinWorkspace = root && target instanceof Element && (root.contains(target)
        || target === window.document.body || target === window.document.documentElement);
      if (!enabled || !withinWorkspace || !(target instanceof Element)
        || target.closest('dialog, [role="dialog"], [data-glossary]') || event.defaultPrevented
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
    open, query, input, composing, matches, count, position, navigate, replace, expanded, replacement, replacementInput, pending, feedback,
    currentId: current ? matches[current.row].cueId : null,
    currentRange: current ? matches[current.row].occurrences[current.position] : undefined,
    canReplaceCurrent: enabled && editable && !pending && Boolean(current),
    canReplaceAll: enabled && editable && !pending && count > 0,
    toggle() {
      if (!enabled) return;
      if (open) close(); else show();
    },
    toggleReplacement() {
      if (!enabled || !editable || operation.current || composing.current) return;
      setExpanded(!expanded); setFeedback(null);
    },
    changeQuery(value: string) { setQuery(value); setCursor(null); setFeedback(null); },
    changeReplacement(value: string) { setReplacement(value); setFeedback(null); },
  };
}
