export interface AudioViewport { start: number; span: number }

export function clampViewport(view: AudioViewport, duration: number): AudioViewport {
  const span = Math.min(Math.max(0, duration), Math.max(0.5, Math.min(60, view.span)));
  return { start: Math.max(0, Math.min(view.start, Math.max(0, duration - span))), span };
}

export function zoomViewport(view: AudioViewport, factor: number, anchor: number, duration: number): AudioViewport {
  const span = clampViewport({ start: 0, span: view.span * factor }, duration).span;
  return clampViewport({ start: view.start + (view.span - span) * Math.max(0, Math.min(1, anchor)), span }, duration);
}

export function timeAtX(x: number, width: number, view: AudioViewport): number {
  return view.start + Math.max(0, Math.min(1, x / Math.max(1, width))) * view.span;
}

/** Existing subtitle edits use a 10ms grid. Never drag past a fractional media end. */
export function boundaryTime(seconds: number, durationMs: number): number {
  return Math.max(0, Math.min(35_999_990, Math.floor(durationMs / 10) * 10, Math.round(seconds * 100) * 10));
}

export function rulerStep(span: number): number {
  return [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find(step => span / step <= 10) || 20;
}
