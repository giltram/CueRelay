import type { Cue } from '../../contracts/subtitles';
import { boundaryTime, type AudioViewport } from './viewport';

/** Real endpoints only; visibility is checked against the pointer gesture's viewport. */
export function cueBoundaryMarkers(cues: readonly Cue[], selectedId: string | null): number[] {
  return cues.flatMap(cue => cue.id === selectedId ? [] : [cue.start_ms, cue.end_ms]);
}

/** Aegisub's default 8 CSS-pixel radius, with Shift bypass and the existing ASS grid. */
export function snapBoundaryTime(seconds: number, duration: number, view: AudioViewport, width: number,
  markers: readonly number[], shiftKey: boolean): number {
  const time = seconds * 1000;
  let nearest: number | null = null;
  if (!shiftKey && width > 0 && view.span > 0) {
    const radius = 8 / width * view.span * 1000;
    for (const marker of markers) {
      if (!Number.isFinite(marker) || marker < 0 || marker > duration || marker > 35_999_990
        || marker < view.start * 1000 || marker > (view.start + view.span) * 1000) continue;
      const distance = Math.abs(marker - time);
      if (distance <= radius && (nearest === null || distance < Math.abs(nearest - time)
        || (distance === Math.abs(nearest - time) && marker < nearest))) nearest = marker;
    }
  }
  return boundaryTime((nearest ?? time) / 1000, duration);
}
