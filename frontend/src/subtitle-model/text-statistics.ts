const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** Display projection only; ASS validity is exclusively owned by the codec. */
export function visibleSubtitleText(text: string): string {
  return text.replace(/\{[^}]*\}/g, '').replace(/\\[Nnh]/g, ' ');
}

/** Preserve the table's Aegisub-style count: graphemes, excluding space/punctuation. */
export function subtitleCharacterCount(text: string): number {
  let count = 0;
  for (const { segment } of graphemes.segment(visibleSubtitleText(text))) {
    if (!/^[\p{White_Space}\p{P}]/u.test(segment)) count++;
  }
  return count;
}
