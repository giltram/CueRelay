import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { referenceGapOffsets, referenceIndexAt, referenceMeasuredOffsets, referenceOffsets, referenceWindow, type ReadingAnchor, type ReferenceRow, type ReferenceHeight } from './window';

/** One owner for programmatic scroll, measured heights and the user's reading anchor. */
export function useReferenceWindow(rows: readonly ReferenceRow[], referenceRows: readonly ReferenceRow[], revealKey: string, revealRequest: object, active: boolean,
  onBrowse: () => void) {
  const content = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, ReferenceHeight>());
  const estimates = useRef(new Map<string, ReferenceHeight>());
  const elements = useRef(new Map<string, HTMLParagraphElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const layout = useRef({ width: 320, rows, referenceRows });
  const anchor = useRef<ReadingAnchor | null>(null);
  const pending = useRef<string | null>(null);
  const restoring = useRef(false);
  const lastTop = useRef(0);
  const viewportHeight = useRef(0);
  const [revision, measure] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 100 });
  const geometry = useRef<{ rows: readonly ReferenceRow[]; offsets: number[] } | null>(null);
  if (!geometry.current || geometry.current.rows !== referenceRows) {
    geometry.current = { rows: referenceRows, offsets: referenceOffsets(referenceRows, heights.current, layout.current.width, estimates.current) };
  }
  const baseOffsets = geometry.current.offsets;
  const gapIndex = rows.length > referenceRows.length ? rows.findIndex(row => row.key === 'gap') : -1;
  const offsets = useMemo(() => referenceGapOffsets(baseOffsets, gapIndex, heights.current.get('gap')?.height ?? 16.25), [baseOffsets, gapIndex, revision]);
  const keyIndex = useMemo(() => new Map(referenceRows.map((row, index) => [row.key, index])), [referenceRows]);
  function indexOfKey(key: string) {
    if (key === 'gap') return gapIndex >= 0 ? gapIndex : undefined;
    const index = keyIndex.get(key);
    return index === undefined ? undefined : index + (gapIndex >= 0 && index >= gapIndex ? 1 : 0);
  }
  const indices = referenceWindow(offsets, viewport.top, viewport.height,
    [anchor.current?.key, pending.current].map(key => indexOfKey(key ?? '') ?? -1));
  const current = useRef({ offsets, rows }); current.current = { offsets, rows };
  const browse = useRef(onBrowse); browse.current = onBrowse;

  const register = useCallback((key: string, element: HTMLParagraphElement | null) => {
    const previous = elements.current.get(key);
    if (previous) observer.current?.unobserve(previous);
    if (element) { elements.current.set(key, element); observer.current?.observe(element); }
    else elements.current.delete(key);
  }, []);

  function readAnchor(top: number) {
    const { offsets, rows } = current.current;
    const index = referenceIndexAt(offsets, top);
    anchor.current = rows[index] ? { key: rows[index].key, inset: top - offsets[index] } : null;
  }
  function readViewport(container: HTMLDivElement) {
    lastTop.current = container.scrollTop;
    viewportHeight.current = container.clientHeight;
    const next = { top: container.scrollTop, height: container.clientHeight };
    setViewport(previous => previous.top === next.top && previous.height === next.height ? previous : next);
  }
  function takeOver() {
    pending.current = null; restoring.current = false;
    browse.current();
    if (content.current) readAnchor(content.current.scrollTop);
  }

  useLayoutEffect(() => {
    if (!active || !content.current) return;
    const container = content.current;
    const changed = (entries: ResizeObserverEntry[]) => {
      if (!container.clientWidth || !container.clientHeight) return;
      if (entries.some(entry => entry.target === container
        ? container.clientWidth !== layout.current.width || container.clientHeight !== viewportHeight.current
        : Math.abs((heights.current.get((entry.target as HTMLElement).dataset.referenceRow ?? '')?.height ?? 0)
          - entry.borderBoxSize[0].blockSize) > .25)) measure(value => value + 1);
    };
    observer.current = new ResizeObserver(changed);
    observer.current.observe(container);
    elements.current.forEach(element => observer.current?.observe(element));
    const scroll = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      // Writes record the actual clamped top synchronously. No timeout can mistake a late
      // programmatic scroll event for user input, or swallow a subsequent user scroll.
      if (Math.abs(container.scrollTop - lastTop.current) > 1) takeOver();
      readViewport(container);
    };
    const keydown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) takeOver();
    };
    container.addEventListener('scroll', scroll, { passive: true });
    container.addEventListener('wheel', takeOver, { passive: true });
    container.addEventListener('touchstart', takeOver, { passive: true });
    container.addEventListener('pointerdown', takeOver); // Scrollbar drag and native text selection.
    container.addEventListener('keydown', keydown);
    return () => {
      observer.current?.disconnect(); observer.current = null;
      container.removeEventListener('scroll', scroll); container.removeEventListener('wheel', takeOver);
      container.removeEventListener('touchstart', takeOver); container.removeEventListener('pointerdown', takeOver);
      container.removeEventListener('keydown', keydown);
    };
  }, [active]);

  useLayoutEffect(() => {
    pending.current = revealKey;
    measure(value => value + 1);
  }, [revealRequest]); // A new object is an explicit locate/follow request, even for the same key.

  useLayoutEffect(() => {
    const container = content.current;
    if (!active || !container?.clientWidth || !container.clientHeight) return;
    const rowsChanged = layout.current.rows !== rows;
    const replaced = layout.current.referenceRows !== referenceRows;
    const resized = layout.current.width !== container.clientWidth;
    if (!rowsChanged && !resized && !restoring.current && !pending.current && Math.abs(container.scrollTop - lastTop.current) > 1) takeOver();
    if (!anchor.current) readAnchor(container.scrollTop);
    let changed = false;
    if (resized) {
      heights.current.clear(); estimates.current.clear(); changed = true;
      geometry.current = { rows: referenceRows, offsets: referenceOffsets(referenceRows, heights.current, container.clientWidth, estimates.current) };
    }
    if (replaced) {
      for (const cache of [heights.current, estimates.current]) {
        for (const key of cache.keys()) if (key !== 'gap' && !keyIndex.has(key)) cache.delete(key);
      }
    }
    layout.current = { width: container.clientWidth, rows, referenceRows };
    const measurements: { index: number; height: number }[] = [];
    for (const [key, element] of elements.current) {
      const height = element.getBoundingClientRect().height;
      if (height > 0 && (heights.current.get(key)?.text !== rows[indexOfKey(key)!].text
        || Math.abs((heights.current.get(key)?.height ?? 0) - height) > .25)) {
        heights.current.set(key, { text: rows[indexOfKey(key)!].text, height }); changed = true;
        const index = keyIndex.get(key);
        if (index !== undefined) measurements.push({ index, height });
      }
    }
    if (measurements.length) geometry.current = { rows: referenceRows,
      offsets: referenceMeasuredOffsets(geometry.current!.offsets, measurements) };
    // Apply offsets to the spacer first in the next layout commit, then adjust scroll. This
    // avoids clamping a distant target to the previous (shorter) spacer's scrollHeight.
    if (changed) { restoring.current = true; measure(value => value + 1); return; }
    const target = indexOfKey(pending.current ?? '');
    const reading = indexOfKey(anchor.current?.key ?? '');
    const top = target !== undefined ? Math.max(0, offsets[target] - Math.min(24, container.clientHeight / 4))
      : reading !== undefined ? offsets[reading] + Math.min(anchor.current?.inset ?? 0, offsets[reading + 1] - offsets[reading] - 1)
        : container.scrollTop;
    container.scrollTop = top;
    readViewport(container); restoring.current = false;
    // Target remains mounted until its real height and the new viewport have been measured.
    if (target === undefined || elements.current.has(rows[target].key)) {
      pending.current = null; readAnchor(container.scrollTop);
    }
  });
  return { content, offsets, indices, register };
}
