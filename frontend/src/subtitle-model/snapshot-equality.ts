/** Compare JSON document parts independent of database/object key ordering.
 * Array order remains significant, including ASS cue and style order.
 */
export function sameSnapshotValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameSnapshotValue(value, right[index]));
  }
  const before = left as Record<string, unknown>, after = right as Record<string, unknown>;
  const keys = Object.keys(before);
  return keys.length === Object.keys(after).length
    && keys.every(key => Object.hasOwn(after, key) && sameSnapshotValue(before[key], after[key]));
}
