import type { Cue } from '../contracts/subtitles';
import { subtitleCharacterCount } from '../subtitle-model/text-statistics';

/** Display statistic only: ignore ASS blocks, whitespace and punctuation. */
export function cueCps(cue: Pick<Cue, 'text' | 'start_ms' | 'end_ms'>): number | null {
  const duration = cue.end_ms - cue.start_ms;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.floor(subtitleCharacterCount(cue.text) * 1000 / duration);
}
