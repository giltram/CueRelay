import { useMemo } from 'react';
import type { Cue } from '../../contracts/subtitles';
import { visibleCueIntervals } from './cue-intervals';
import type { AudioViewport } from './viewport';
import { BoundaryCaps } from './BoundaryCaps';

interface Props { cues: readonly Cue[]; selectedId: string | null; view: AudioViewport }

/** Noninteractive context for other subtitles; editing remains on active boundaries. */
export function AudioCueIntervals({ cues, selectedId, view }: Props) {
  const intervals = useMemo(() => visibleCueIntervals(cues, selectedId, view), [cues, selectedId, view.start, view.span]);
  return <div className="audio-cue-intervals" aria-hidden="true">
    {intervals.map(interval => <div className="audio-cue-interval" key={interval.id} data-cue-id={interval.id}
      style={{ left: `${interval.left}%`, width: `${interval.width}%` }}>
      {interval.startVisible && <span className="cue-edge start"><BoundaryCaps /></span>}
      {interval.endVisible && <span className="cue-edge end"><BoundaryCaps /></span>}
    </div>)}
  </div>;
}
