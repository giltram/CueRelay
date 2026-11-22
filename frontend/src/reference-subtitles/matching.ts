import type { ReferenceCue } from '../contracts/projects';

export interface Interval { start_ms: number; end_ms: number }
export type OrderedReferenceCue = ReferenceCue & { sourceIndex: number };

export function orderReference(cues: readonly ReferenceCue[]): OrderedReferenceCue[] {
  return cues.map((cue, sourceIndex) => ({ ...cue, sourceIndex }))
    .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms || a.sourceIndex - b.sourceIndex);
}

function overlaps(cue: Interval, query: Interval) {
  if (query.start_ms === query.end_ms) return cue.start_ms === cue.end_ms
    ? cue.start_ms === query.start_ms : cue.start_ms <= query.start_ms && query.start_ms < cue.end_ms;
  if (cue.start_ms === cue.end_ms) return query.start_ms <= cue.start_ms && cue.start_ms < query.end_ms;
  return cue.start_ms < query.end_ms && query.start_ms < cue.end_ms;
}

/** Inputs are sorted once; every match is retained, including empty text. */
export function matchReference(cues: readonly OrderedReferenceCue[], query: Interval) {
  const matches = cues.filter(cue => overlaps(cue, query));
  let before: OrderedReferenceCue | undefined, after: OrderedReferenceCue | undefined;
  if (matches.length) {
    const first = cues.indexOf(matches[0]), last = cues.indexOf(matches[matches.length - 1]);
    before = cues[first - 1]; after = cues[last + 1];
  } else {
    for (const cue of cues) {
      if (cue.end_ms <= query.start_ms && (!before || cue.end_ms >= before.end_ms)) before = cue;
      if (cue.start_ms >= query.end_ms && !after) after = cue;
    }
  }
  return { matches, before, after };
}

/** Audition's actual audio clock has priority; stopped media returns to the selected cue. */
export function referenceContext(selected: Interval | undefined, videoTime: number, videoPlaying: boolean,
  auditionPlaying: boolean, auditionTime: number | null): Interval {
  if (auditionPlaying && auditionTime !== null) return { start_ms: auditionTime, end_ms: auditionTime };
  if (videoPlaying || !selected) return { start_ms: videoTime, end_ms: videoTime };
  return selected;
}
