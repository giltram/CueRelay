export const cueColumns = [
  { id: 'start', label: '入', defaultWidth: 100, minimum: 96, maximum: 280 },
  { id: 'end', label: '出', defaultWidth: 100, minimum: 96, maximum: 280 },
  { id: 'cps', label: 'CPS', defaultWidth: 44, minimum: 40, maximum: 120 },
  { id: 'style', label: 'style', defaultWidth: 88, minimum: 64, maximum: 320 },
] as const;

export type CueColumn = typeof cueColumns[number];
export type CueColumnWidths = Record<CueColumn['id'], number>;
export const cueRowNumberWidth = 44;
const minimumTextWidth = 180;

export function defaultCueColumnWidths(): CueColumnWidths {
  return Object.fromEntries(cueColumns.map(column => [column.id, column.defaultWidth])) as CueColumnWidths;
}

export function clampCueColumnWidth(column: CueColumn, width: number): number {
  return Math.min(column.maximum, Math.max(column.minimum, width));
}

/** Keep text usable; narrow viewports scroll inside the table container. */
export function cueTableMinimumWidth(widths: CueColumnWidths): number {
  return cueRowNumberWidth + minimumTextWidth + cueColumns.reduce((total, column) => total + widths[column.id], 0);
}
