import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Cue } from '../contracts/subtitles';
import { cueAnchorAfterRowsChange, cueAnchorScrollTop, cueIndexAtOffset, cueRevealScrollTop, cueWindowIndices, cueWindowOffsets, type CueScrollAnchor } from './cue-window';

/** Owns only DOM measurements/scrolling. Selection, ordering and search stay with their existing owners. */
export function useCueWindow(rows: Cue[], scroll: RefObject<HTMLDivElement | null>, layoutKey: string) {
  const enabled = rows.length > 200;
  const heights = useRef(new Map<string, { text: string; height: number }>());
  const elements = useRef(new Map<string, HTMLTableRowElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const layout = useRef<{ width: number; key: string; rows: Cue[]; enabled: boolean } | null>(null);
  const anchor = useRef<CueScrollAnchor | null>(null);
  const previousRows = useRef(rows);
  const lastScrollTop = useRef(0);
  const restoring = useRef(false);
  const [measurement, setMeasurement] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pendingFocus = useRef<{ id: string; last: boolean } | null>(null);
  const pendingReveal = useRef<string | null>(null);
  const offsets = useMemo(() => cueWindowOffsets(rows, heights.current), [rows, measurement]);
  const current = useRef({ rows, offsets }); current.current = { rows, offsets };
  const indices = enabled ? cueWindowIndices(offsets, viewport.top, viewport.height, rows.findIndex(cue => cue.id === focusedId),
    [anchor.current?.id, pendingReveal.current].map(id => rows.findIndex(cue => cue.id === id))) : rows.map((_, index) => index);
  const registerRow = useCallback((id: string, element: HTMLTableRowElement | null) => {
    const previous = elements.current.get(id);
    if (previous) observer.current?.unobserve(previous);
    if (element) { elements.current.set(id, element); observer.current?.observe(element); }
    else elements.current.delete(id);
  }, []);

  function readViewport(container: HTMLDivElement) {
    const next = { top: container.scrollTop, height: container.clientHeight };
    lastScrollTop.current = next.top;
    setViewport(previous => previous.top === next.top && previous.height === next.height ? previous : next);
  }
  function readAnchor(container: HTMLDivElement): CueScrollAnchor | null {
    const { rows, offsets } = current.current;
    const header = container.querySelector('thead')?.getBoundingClientRect().bottom ?? container.getBoundingClientRect().top;
    const bottom = container.getBoundingClientRect().bottom;
    let first: { id: string; top: number } | null = null;
    for (const [id, element] of elements.current) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > header && rect.top < bottom && (!first || rect.top < first.top)) first = { id, top: rect.top };
    }
    // A large direct scroll may land in an unmounted spacer. Use its model position until mounted.
    const index = first ? rows.findIndex(cue => cue.id === first.id) : cueIndexAtOffset(offsets, container.scrollTop);
    return rows[index] ? { id: rows[index].id, inset: !enabled && first ? header - first.top : container.scrollTop - offsets[index] } : null;
  }

  useLayoutEffect(() => {
    if (!scroll.current) return;
    const container = scroll.current;
    const changed = () => {
      // Hidden geometry cannot invalidate the last useful measurements or reading position.
      if (container.clientWidth && container.clientHeight) setMeasurement(value => value + 1);
    };
    observer.current = new ResizeObserver(changed);
    elements.current.forEach(element => observer.current?.observe(element));
    const resize = new ResizeObserver(changed); resize.observe(container);
    const read = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      if (Math.abs(container.scrollTop - lastScrollTop.current) > 1) {
        pendingReveal.current = null;
        anchor.current = readAnchor(container);
      }
      readViewport(container);
    };
    container.addEventListener('scroll', read, { passive: true });
    return () => { observer.current?.disconnect(); observer.current = null; resize.disconnect(); container.removeEventListener('scroll', read); };
  }, [enabled]);

  useLayoutEffect(() => {
    const ids = new Set(rows.map(cue => cue.id));
    for (const id of heights.current.keys()) if (!ids.has(id)) heights.current.delete(id);
    if (anchor.current && !ids.has(anchor.current.id)) {
      anchor.current = cueAnchorAfterRowsChange(previousRows.current, rows, anchor.current);
    }
    previousRows.current = rows;
    if (pendingReveal.current && !ids.has(pendingReveal.current)) pendingReveal.current = null;
  }, [rows]);

  // Measure and restore together before paint. The logical anchor survives every measurement commit.
  useLayoutEffect(() => {
    const container = scroll.current;
    if (!container?.clientWidth || !container.clientHeight) return;
    const modeChanged = layout.current !== null && layout.current.enabled !== enabled;
    // Browser focus/scrollIntoView can move the list before its scroll event arrives.
    // Adopt that user position before a focus-triggered render can restore the old anchor.
    if (enabled && !modeChanged && !restoring.current && layout.current?.rows === rows && layout.current.width === container.clientWidth
      && layout.current.key === layoutKey && Math.abs(container.scrollTop - lastScrollTop.current) > 1) {
      pendingReveal.current = null; anchor.current = readAnchor(container);
    }
    let changed = false;
    if (layout.current && (layout.current.width !== container.clientWidth || layout.current.key !== layoutKey)) {
      heights.current.clear(); changed = true;
    }
    layout.current = { width: container.clientWidth, key: layoutKey, rows, enabled };
    if (!anchor.current) anchor.current = readAnchor(container);
    const byId = new Map(rows.map(cue => [cue.id, cue]));
    for (const [id, element] of elements.current) {
      const cue = byId.get(id), height = element.getBoundingClientRect().height;
      if (!cue || height <= 0) continue;
      const previous = heights.current.get(id);
      if (previous?.text !== cue.text || Math.abs(previous.height - height) > .5) {
        heights.current.set(id, { text: cue.text, height }); changed = true;
      }
    }
    const nextOffsets = changed ? cueWindowOffsets(rows, heights.current) : offsets;
    if (!enabled) {
      // Native scrolling owns ordinary small-list layout; only the mode boundary restores an anchor.
      pendingReveal.current = null; pendingFocus.current = null; restoring.current = false;
    }
    const targetIndex = rows.findIndex(cue => cue.id === pendingReveal.current);
    const header = container.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const top = targetIndex >= 0 ? cueRevealScrollTop(nextOffsets, targetIndex, container.scrollTop, container.clientHeight, header)
      : anchor.current && (enabled || modeChanged) ? cueAnchorScrollTop(rows, nextOffsets, anchor.current) : null;
    if (top !== null && Math.abs(container.scrollTop - top) > .5) {
      container.scrollTop = top;
    }
    readViewport(container);
    if (!enabled) {
      // All native rows are mounted: retain their measurements and the current DOM reading position
      // for a later return to windowing, without forcing an extra native measurement commit.
      anchor.current = readAnchor(container);
      return;
    }
    if (changed) { restoring.current = true; setMeasurement(value => value + 1); return; }
    // The rendered spacers now use these measured offsets; only then finish reveal/focus.
    pendingReveal.current = null;
    restoring.current = false;
    anchor.current = readAnchor(container);
    const focus = pendingFocus.current;
    const element = focus ? elements.current.get(focus.id) : null;
    if (focus && element) {
      pendingFocus.current = null;
      element.querySelector<HTMLButtonElement>(focus.last ? '.cue-text' : '.row-number')?.focus({ preventScroll: true });
    }
  });

  function reveal(id: string) {
    const container = scroll.current;
    if (!container || !rows.some(cue => cue.id === id)) return;
    if (enabled) {
      pendingReveal.current = id;
      setMeasurement(value => value + 1);
      return;
    }
    const row = elements.current.get(id);
    if (!row) return;
    const viewport = container.getBoundingClientRect(), rect = row.getBoundingClientRect();
    const header = container.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    if (rect.top < viewport.top + header || rect.height > container.clientHeight - header) container.scrollTop += rect.top - viewport.top - header;
    else if (rect.bottom > viewport.bottom) container.scrollTop += rect.bottom - viewport.bottom;
  }
  return { enabled, offsets, indices, registerRow, reveal,
    onFocus(id: string | null) { setFocusedId(id); },
    focusAdjacent(id: string, backwards: boolean) {
      const index = rows.findIndex(cue => cue.id === id) + (backwards ? -1 : 1);
      const next = rows[index];
      if (!next || elements.current.has(next.id)) return false;
      pendingFocus.current = { id: next.id, last: backwards }; reveal(next.id);
      return true;
    },
  };
}
