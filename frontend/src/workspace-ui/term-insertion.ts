/** UTF-16 cursor offsets belong to one selected row, never a previous row. */
export interface TextSelection { cueId: string; start: number; end: number }
export function insertTranslation(text: string, cueId: string, translation: string, selection: TextSelection | null) {
  // Use the same ASS line-break representation as normal subtitle input.
  translation = translation.replace(/\r\n?|\n/g, '\\N');
  const valid = selection?.cueId === cueId && selection.start >= 0 && selection.end >= selection.start && selection.end <= text.length;
  const start = valid ? selection.start : text.length, end = valid ? selection.end : text.length;
  return { text: text.slice(0, start) + translation + text.slice(end), cursor: start + translation.length };
}
