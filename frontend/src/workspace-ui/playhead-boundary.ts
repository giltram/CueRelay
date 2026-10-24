import type { Cue } from '../contracts/subtitles';
import { snapTime, validateInterval } from '../media/playback';

/** Validate before changing either endpoint; keep the opposite saved endpoint. */
export function playheadBoundary(cue: Cue, point: 'start' | 'end', seconds: number): Cue {
  const time = snapTime(seconds);
  const updated = { ...cue, [point === 'start' ? 'start_ms' : 'end_ms']: time };
  validateInterval(updated.start_ms, updated.end_ms);
  return updated;
}
