import type { MessageValue } from '../contracts/messages';
import type { AssDocument } from '../contracts/subtitles';
import { appendSourceRanges, literalMatches, projectCueText, type SearchCursor, type TextRange } from './cue-search';

export interface ReplaceCueRequest {
  query: string;
  replacement: string;
  target: 'all' | SearchCursor;
}

export type ReplaceFeedback = { count: number } | { message: MessageValue };
export type ReplaceFailure = 'invalid-input' | 'stale-match' | 'changed-syntax' | 'text-too-long' | 'document-too-large';
type ReplaceResult = { document: AssDocument; count: number } | { reason: ReplaceFailure };

// Allocation bounds from the codec's 16384 Unicode characters per line and 1 MiB file budget.
// The serializer still checks exact character counts and the complete file.
const MAX_TEXT_CODE_UNITS = 2 * 16_384;
const MAX_ASS_BYTES = 1024 * 1024;

/** Prepare an immutable snapshot. The caller validates it with the ASS serializer before applying it. */
export function replaceCueText(document: AssDocument, { query, replacement, target }: ReplaceCueRequest): ReplaceResult {
  if (!query) return { document, count: 0 };
  if (/[{}\\]/.test(replacement)) return { reason: 'invalid-input' };
  const encoded = replacement.replace(/\r\n?|\n/g, '\\N');
  const visibleReplacement = replacement.replace(/\r\n?|\n/g, ' ');
  const cues = [...document.cues];
  const encoder = new TextEncoder();
  let count = 0, changedBytes = 0, targetFound = false;
  for (const [index, cue] of document.cues.entries()) {
    if (target !== 'all' && cue.id !== target.cueId) continue;
    if (target !== 'all' && cue.text !== target.source) return { reason: 'stale-match' };
    const result = replaceInSource(cue.text, query, encoded, visibleReplacement, target === 'all' ? undefined : target.start);
    if ('reason' in result) return result;
    targetFound ||= result.found;
    if (!result.count) continue;
    changedBytes += encoder.encode(result.text).byteLength;
    if (changedBytes > MAX_ASS_BYTES) return { reason: 'document-too-large' };
    cues[index] = { ...cue, text: result.text };
    count += result.count;
  }
  if (target !== 'all' && !targetFound) return { reason: 'stale-match' };
  return { document: count ? { ...document, cues } : document, count };
}

function replaceInSource(source: string, query: string, encoded: string, visibleReplacement: string, targetStart?: number):
  { text: string; count: number; found: boolean } | { reason: ReplaceFailure } {
  const { visible, offsets } = projectCueText(source);
  const rawParts: string[] = [], visibleParts: string[] = [];
  let rawEnd = 0, visibleEnd = 0, count = 0, written = 0, found = false;
  for (const { start, end } of literalMatches(visible, query, targetStart !== undefined)) {
    if (targetStart !== undefined && offsets[start].start !== targetStart) continue;
    found = true;
    const ranges: TextRange[] = [];
    appendSourceRanges(ranges, offsets, start, end);
    const matchedRaw = ranges.map(range => source.slice(range.start, range.end)).join('');
    if (matchedRaw === encoded) continue;

    visibleParts.push(visible.slice(visibleEnd, start), visibleReplacement);
    visibleEnd = end;
    rawParts.push(source.slice(rawEnd, ranges[0].start), encoded);
    written += ranges[0].start - rawEnd + encoded.length;
    // Keep intervening tags at their original positions relative to the remaining source.
    for (const range of ranges) {
      if (range.start !== ranges[0].start) {
        rawParts.push(source.slice(rawEnd, range.start));
        written += range.start - rawEnd;
      }
      rawEnd = range.end;
    }
    if (written > MAX_TEXT_CODE_UNITS) return { reason: 'text-too-long' };
    count++;
  }
  if (!count) return { text: source, count, found };
  if (written + source.length - rawEnd > MAX_TEXT_CODE_UNITS) return { reason: 'text-too-long' };
  const text = rawParts.join('') + source.slice(rawEnd);
  if (text === source) return { text, count: 0, found };
  // Repairs to an invalid draft must not accidentally turn its remaining literal text into ASS syntax.
  if (projectCueText(text).visible !== visibleParts.join('') + visible.slice(visibleEnd)) {
    return { reason: 'changed-syntax' };
  }
  return { text, count, found };
}
