/** Geometry only; reference matching and media state are owned by the panel. */
export interface ReferenceRow { key: string; text: string }
export interface ReferenceHeight { text: string; height: number }
export interface ReadingAnchor { key: string; inset: number }

export function referenceOffsets(rows: readonly ReferenceRow[], heights: ReadonlyMap<string, ReferenceHeight>, width: number, estimates = new Map<string, ReferenceHeight>()) {
  const offsets = [0];
  // Conservative estimate for unmounted proportional text. Mounted rows always use actual height.
  const columns = Math.max(1, Math.floor(width / 8));
  for (const row of rows) {
    let estimate = estimates.get(row.key);
    if (estimate?.text !== row.text) {
      const lines = row.text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0);
      estimate = { text: row.text, height: lines * 16.25 }; estimates.set(row.key, estimate);
    }
    const measured = heights.get(row.key);
    offsets.push(offsets[offsets.length - 1] + (measured?.text === row.text ? measured.height : estimate.height));
  }
  return offsets;
}

export function referenceIndexAt(offsets: readonly number[], top: number) {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= top) low = middle; else high = middle - 1;
  }
  return Math.max(0, Math.min(low, offsets.length - 2));
}

export function referenceWindow(offsets: readonly number[], top: number, height: number, retained: readonly number[] = []) {
  const first = Math.max(0, referenceIndexAt(offsets, top) - 6);
  const last = Math.min(offsets.length - 2, referenceIndexAt(offsets, top + height) + 6);
  const indices = new Set<number>();
  for (let index = first; index <= last; index++) indices.add(index);
  for (const index of retained) if (index >= 0 && index < offsets.length - 1) indices.add(index);
  return [...indices].sort((a, b) => a - b);
}

/** Insert a transient gap notice without invalidating measured cue geometry. */
export function referenceGapOffsets(offsets: readonly number[], gapIndex: number, gapHeight: number): readonly number[] {
  if (gapIndex < 0) return offsets;
  return [...offsets.slice(0, gapIndex + 1), ...offsets.slice(gapIndex).map(offset => offset + gapHeight)];
}

/** Correct measured rows by numeric suffix deltas; do not rescan every subtitle's text/cache. */
export function referenceMeasuredOffsets(offsets: readonly number[], measurements: readonly { index: number; height: number }[]) {
  const next = [...offsets];
  for (const { index, height } of measurements) {
    const delta = height - (next[index + 1] - next[index]);
    for (let following = index + 1; following < next.length; following++) next[following] += delta;
  }
  return next;
}
