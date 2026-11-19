import type { Cue } from '../contracts/subtitles';
import { orderCues } from '../subtitle-model/cue-order';

export interface TextRange { start: number; end: number }
export interface CueMatch {
  cueId: string;
  source: string;
  occurrences: TextRange[];
  ranges: TextRange[];
}
export interface SearchCursor { cueId: string; source: string; start: number }
export type SearchDirection = 'next' | 'previous';

// English case folding preserves UTF-16 offsets, including non-English text.
const foldEnglish = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** Search projection only. Unsupported or incomplete syntax stays literal. */
export function projectCueText(source: string) {
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
  return { visible, offsets };
}

export function* literalMatches(visible: string, query: string, overlap: boolean): Generator<TextRange> {
  if (!query) return;
  const haystack = foldEnglish(visible), needle = foldEnglish(query);
  const step = overlap ? 1 : needle.length;
  for (let start = haystack.indexOf(needle); start !== -1; start = haystack.indexOf(needle, start + step)) {
    yield { start, end: start + needle.length };
  }
}

export function appendSourceRanges(ranges: TextRange[], offsets: readonly TextRange[], start: number, end: number) {
  for (let index = start; index < end; index++) {
    const offset = offsets[index], previous = ranges.at(-1);
    if (previous?.end === offset.start) previous.end = offset.end;
    else ranges.push({ ...offset });
  }
}

export function matchCueText(source: string, query: string) {
  const { visible, offsets } = projectCueText(source);
  const occurrences: TextRange[] = [], ranges: TextRange[] = [];
  let highlightedUntil = 0;
  for (const { start, end } of literalMatches(visible, query, true)) {
    occurrences.push({ start: offsets[start].start, end: offsets[end - 1].end });
    // Map the highlighted union once, even when occurrences overlap.
    appendSourceRanges(ranges, offsets, Math.max(start, highlightedUntil), end);
    highlightedUntil = end;
  }
  return { occurrences, ranges };
}

/** Group occurrences and highlights per cue, in stable table order. */
export function findCueMatches(cues: readonly Cue[], query: string): CueMatch[] {
  if (!query) return [];
  return orderCues(cues).flatMap(cue => {
    const match = matchCueText(cue.text, query);
    return match.occurrences.length ? [{ cueId: cue.id, source: cue.text, ...match }] : [];
  });
}

export function currentOccurrence(matches: readonly CueMatch[], cursor: SearchCursor | null) {
  if (!cursor) return null;
  const row = matches.findIndex(match => match.cueId === cursor.cueId && match.source === cursor.source);
  if (row < 0) return null;
  const position = matches[row].occurrences.findIndex(range => range.start === cursor.start);
  return position < 0 ? null : { row, position };
}

/** A missing or stale cursor starts inclusively from the selected row. */
export function navigateCueMatches(
  cues: readonly Cue[], matches: readonly CueMatch[], selectedId: string | null,
  cursor: SearchCursor | null, direction: SearchDirection,
): SearchCursor | null {
  if (!matches.length) return null;
  const next = direction === 'next';
  const step = next ? 1 : -1;
  const current = currentOccurrence(matches, cursor);
  if (current) {
    const { row, position } = current;
    const adjacent = matches[row].occurrences[position + step];
    if (adjacent) return { cueId: matches[row].cueId, source: matches[row].source, start: adjacent.start };
    return firstOccurrence(matches[(row + step + matches.length) % matches.length], next);
  }

  const ordered = orderCues(cues);
  const positions = new Map(ordered.map((cue, index) => [cue.id, index]));
  const selectedIndex = selectedId ? positions.get(selectedId) : undefined;
  const candidates = next ? matches : [...matches].reverse();
  const row = candidates.find(match => selectedIndex === undefined ||
    (next ? positions.get(match.cueId)! >= selectedIndex : positions.get(match.cueId)! <= selectedIndex)) ?? candidates[0];
  return firstOccurrence(row, next);
}

function firstOccurrence(match: CueMatch, next: boolean): SearchCursor {
  return { cueId: match.cueId, source: match.source, start: match.occurrences.at(next ? 0 : -1)!.start };
}
