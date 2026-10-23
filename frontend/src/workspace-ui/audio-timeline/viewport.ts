export interface AudioViewport { start: number; span: number }

export function clampViewport(view: AudioViewport, duration: number): AudioViewport {
  const span = Math.min(Math.max(0, duration), Math.max(0.5, Math.min(60, view.span)));
  return { start: Math.max(0, Math.min(view.start, Math.max(0, duration - span))), span };
}

export function zoomViewport(view: AudioViewport, factor: number, anchor: number, duration: number): AudioViewport {
  const span = clampViewport({ start: 0, span: view.span * factor }, duration).span;
  return clampViewport({ start: view.start + (view.span - span) * Math.max(0, Math.min(1, anchor)), span }, duration);
}

export function wheelViewport(view: AudioViewport,
  event: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean },
  width: number, anchor: number, duration: number): AudioViewport {
  const visible = clampViewport(view, duration);
  // Some browsers remap Shift+vertical wheel to deltaX; accept either dominant axis.
  const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1);
  if (event.shiftKey) return zoomViewport(visible, Math.exp(Math.max(-0.7, Math.min(0.7, delta * 0.004))), anchor, duration);
  return clampViewport({ ...visible, start: visible.start + delta / Math.max(1, width) * visible.span }, duration);
}

export function timeAtX(x: number, width: number, view: AudioViewport): number {
  return view.start + Math.max(0, Math.min(1, x / Math.max(1, width))) * view.span;
}

/** Shared by the ruler, spectrum and DOM overlays; offscreen times stay offscreen. */
export function xAtTime(seconds: number, width: number, view: AudioViewport): number {
  return view.span > 0 ? (seconds - view.start) / view.span * width : 0;
}

/** Existing subtitle edits use a 10ms grid. Never drag past a fractional media end. */
export function boundaryTime(seconds: number, durationMs: number): number {
  return Math.max(0, Math.min(35_999_990, Math.floor(durationMs / 10) * 10, Math.round(seconds * 100) * 10));
}
