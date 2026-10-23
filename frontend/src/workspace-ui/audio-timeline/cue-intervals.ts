import type { Cue } from '../../contracts/subtitles';
import { xAtTime, type AudioViewport } from './viewport';

/** Percent geometry shared by signal clipping and both kinds of boundary overlay. */
export function intervalPosition(startMs: number, endMs: number, view: AudioViewport) {
  const start = startMs / 1000; const end = endMs / 1000;
  if (view.span <= 0 || end <= start || end <= view.start || start >= view.start + view.span) return null;
  const left = Math.max(0, xAtTime(start, 100, view));
  const right = Math.min(100, xAtTime(end, 100, view));
  return { left, width: right - left, startVisible: start >= view.start, endVisible: end <= view.start + view.span };
}

/** Read-only background ranges, clipped to the same viewport as active boundaries. */
export function visibleCueIntervals(cues: readonly Cue[], selectedId: string | null, view: AudioViewport) {
  if (view.span <= 0) return [];
  return cues.flatMap(cue => {
    if (cue.id === selectedId) return [];
    const position = intervalPosition(cue.start_ms, cue.end_ms, view);
    return position ? [{ id: cue.id, ...position }] : [];
  });
}
