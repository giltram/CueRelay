import type { Cue } from '../contracts/subtitles';

/** Display/navigation order only; preserve the document's original ASS event order. */
export function orderCues(cues: readonly Cue[]): Cue[] {
  return cues.map((cue, order) => ({ cue, order })).sort((a, b) =>
    a.cue.start_ms - b.cue.start_ms || a.cue.end_ms - b.cue.end_ms || a.order - b.order,
  ).map(({ cue }) => cue);
}
