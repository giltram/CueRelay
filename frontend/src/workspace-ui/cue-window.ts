/** Variable-height row offsets. Unknown rows use the existing single-line height. */
export function cueWindowOffsets(ids: readonly { id: string; text: string }[], heights: ReadonlyMap<string, { text: string; height: number }>): number[] {
  const offsets = [0];
  for (const cue of ids) {
    const measured = heights.get(cue.id);
    offsets.push(offsets[offsets.length - 1] + (measured?.text === cue.text ? measured.height : 33));
  }
  return offsets;
}

export function cueIndexAtOffset(offsets: readonly number[], offset: number): number {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= offset) low = middle; else high = middle - 1;
  }
  return Math.min(low, offsets.length - 2);
}

/** Include a small scroll buffer and the focused row so browser focus is never unmounted. */
export function cueWindowIndices(offsets: readonly number[], top: number, height: number, focusedIndex: number, retainedIndices: readonly number[] = []): number[] {
  const count = offsets.length - 1;
  if (!count) return [];
  const first = Math.max(0, cueIndexAtOffset(offsets, top) - 8);
  const last = Math.min(count - 1, cueIndexAtOffset(offsets, top + height) + 8);
  const indices = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  for (const index of [focusedIndex, ...retainedIndices]) {
    if (index >= 0 && index < count && !indices.includes(index)) indices.push(index);
  }
  return indices.sort((a, b) => a - b);
}

export interface CueScrollAnchor { id: string; inset: number }

/** Resolve deleted anchors in the last committed order, before reading the changed DOM. */
export function cueAnchorAfterRowsChange(previousRows: readonly { id: string }[], rows: readonly { id: string }[], anchor: CueScrollAnchor | null): CueScrollAnchor | null {
  if (!anchor || rows.some(row => row.id === anchor.id)) return anchor;
  const index = previousRows.findIndex(row => row.id === anchor.id);
  if (index < 0) return null;
  const ids = new Set(rows.map(row => row.id));
  // Prefer the next surviving row, including across a deleted range; use a predecessor at the end.
  for (let next = index + 1; next < previousRows.length; next++) {
    if (ids.has(previousRows[next].id)) return { id: previousRows[next].id, inset: anchor.inset };
  }
  for (let previous = index - 1; previous >= 0; previous--) {
    if (ids.has(previousRows[previous].id)) return { id: previousRows[previous].id, inset: anchor.inset };
  }
  return null;
}

/** Preserve a logical reading position while heights before it change. */
export function cueAnchorScrollTop(rows: readonly { id: string }[], offsets: readonly number[], anchor: CueScrollAnchor): number | null {
  const index = rows.findIndex(row => row.id === anchor.id);
  if (index < 0) return null;
  // If wrapping made the row shorter, keep its last visible pixel rather than moving to the next row.
  const inset = Math.min(anchor.inset, offsets[index + 1] - offsets[index] - 1);
  return Math.max(0, offsets[index] + inset);
}

/** Minimal reveal; a row taller than the usable viewport starts below the sticky header. */
export function cueRevealScrollTop(offsets: readonly number[], index: number, top: number, height: number, header: number): number {
  const start = offsets[index], end = offsets[index + 1];
  if (start < top || end - start > height - header) return start;
  return Math.max(top, end + header - height);
}
