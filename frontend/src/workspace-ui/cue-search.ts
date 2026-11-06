import type { Cue } from '../contracts/subtitles';
import { orderCues } from '../subtitle-model/cue-order';

export interface TextRange { start: number; end: number }
export interface CueMatch { cueId: string; ranges: TextRange[] }
export type SearchDirection = 'next' | 'previous';

// English case folding preserves UTF-16 offsets, including non-English text.
const foldEnglish = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** Search visible text while retaining offsets into the unchanged ASS source.
 * Only the codec's supported b/i/u/s 0/1 blocks are hidden. Incomplete or
 * unsupported tags in an unsaved draft remain literal text.
 */
export function matchCueText(source: string, query: string): TextRange[] {
  if (!query) return [];
  let visible = '';
  const offsets: TextRange[] = [];
  for (let start = 0; start < source.length;) {
    if (source[start] === '{') {
      const end = source.indexOf('}', start);
      if (end !== -1 && /^(?:\\[bius][01])+$/.test(source.slice(start + 1, end))) {
        start = end + 1;
        continue;
      }
    }
    const escaped = source[start] === '\\' && /[Nnh]/.test(source[start + 1] ?? '');
    const end = start + (escaped ? 2 : 1);
    visible += escaped ? ' ' : source[start];
    offsets.push({ start, end });
    start = end;
  }
  const haystack = foldEnglish(visible), needle = foldEnglish(query);
  const ranges: TextRange[] = [];
  let highlightedUntil = 0;
  // Advance by one so overlapping literal occurrences are highlighted too.
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    // Map each visible character once, even for heavily overlapping matches.
    for (let index = Math.max(at, highlightedUntil); index < at + needle.length; index++) {
      const offset = offsets[index], previous = ranges.at(-1);
      if (previous && offset.start <= previous.end) previous.end = Math.max(previous.end, offset.end);
      else ranges.push({ ...offset });
    }
    highlightedUntil = at + needle.length;
  }
  return ranges;
}

/** One result per cue, in the same stable time order as the full table. */
export function findCueMatches(cues: readonly Cue[], query: string): CueMatch[] {
  if (!query) return [];
  return orderCues(cues).flatMap(cue => {
    const ranges = matchCueText(cue.text, query);
    return ranges.length ? [{ cueId: cue.id, ranges }] : [];
  });
}

/** A null/removed cursor starts inclusively from the selected row. */
export function navigateCueMatches(
  cues: readonly Cue[], matches: readonly CueMatch[], selectedId: string | null,
  currentId: string | null, direction: SearchDirection,
): string | null {
  if (!matches.length) return null;
  const currentIndex = matches.findIndex(match => match.cueId === currentId);
  const step = direction === 'next' ? 1 : -1;
  if (currentIndex !== -1) return matches[(currentIndex + step + matches.length) % matches.length].cueId;
  const ordered = orderCues(cues);
  const positions = new Map(ordered.map((cue, index) => [cue.id, index]));
  const selectedIndex = selectedId ? positions.get(selectedId) : undefined;
  const candidates = direction === 'next' ? matches : [...matches].reverse();
  return (candidates.find(match => selectedIndex === undefined ||
    (direction === 'next' ? positions.get(match.cueId)! >= selectedIndex : positions.get(match.cueId)! <= selectedIndex))
    ?? candidates[0]).cueId;
}
