import type { Cue } from '../contracts/subtitles';

const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** Display statistic only: ignore ASS blocks, whitespace and punctuation. */
export function cueCps(cue: Pick<Cue, 'text' | 'start_ms' | 'end_ms'>): number | null {
  const duration = cue.end_ms - cue.start_ms;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const text = cue.text.replace(/\{[^}]*\}/g, '').replace(/\\[Nnh]/g, '');
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (!/^[\p{White_Space}\p{P}]/u.test(segment)) count++;
  }
  return Math.floor(count * 1000 / duration);
}
