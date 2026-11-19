import { MessageError } from '../contracts/messages';
import type { AssDocument } from '../contracts/subtitles';
import { MAX_TIME_MS, validateInterval } from './timing';

export type TimeShiftFailure = 'invalid-offset' | 'out-of-range' | 'invalid-interval';
type TimeShiftResult = { document: AssDocument } | { reason: TimeShiftFailure };

/** Shift both endpoints on the ASS time grid, preserving document event order. */
export function shiftCueTimes(
  document: AssDocument, targets: 'all' | ReadonlySet<string>, offsetMs: number,
): TimeShiftResult {
  if (!Number.isSafeInteger(offsetMs) || offsetMs % 10 !== 0) return { reason: 'invalid-offset' };
  if (offsetMs === 0) return { document };

  const cues = document.cues.slice();
  let changed = false;
  for (const [index, cue] of document.cues.entries()) {
    if (targets !== 'all' && !targets.has(cue.id)) continue;
    const start = cue.start_ms + offsetMs;
    const end = cue.end_ms + offsetMs;
    try {
      validateInterval(start, end);
    } catch (error) {
      if (!(error instanceof MessageError)) throw error;
      return { reason: [start, end].some(time => time < 0 || time > MAX_TIME_MS) ? 'out-of-range' : 'invalid-interval' };
    }
    cues[index] = { ...cue, start_ms: start, end_ms: end };
    changed = true;
  }
  return { document: changed ? { ...document, cues } : document };
}
