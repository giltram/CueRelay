import { describe, expect, it } from 'vitest';
import { clampCueColumnWidth, cueColumns, cueRowNumberWidth, cueTableMinimumWidth, defaultCueColumnWidths } from './cue-column-widths';

describe('subtitle grid column widths', () => {
  it('starts compact and reserves at least 180 pixels for subtitle text', () => {
    const widths = defaultCueColumnWidths();
    expect(widths).toEqual({ start: 100, end: 100, cps: 44, style: 88 });
    expect(cueTableMinimumWidth(widths)).toBe(556);
    expect(cueTableMinimumWidth(widths) - cueRowNumberWidth - Object.values(widths).reduce((a, b) => a + b)).toBe(180);
  });

  it('clamps dragging at readable minimums and bounded maximums', () => {
    for (const column of cueColumns) {
      expect(clampCueColumnWidth(column, -1000)).toBe(column.minimum);
      expect(clampCueColumnWidth(column, 1000)).toBe(column.maximum);
      expect(clampCueColumnWidth(column, column.defaultWidth)).toBe(column.defaultWidth);
    }
  });

  it('keeps independent defaults and grows the scrollable table instead of squeezing text', () => {
    const widths = defaultCueColumnWidths();
    widths.style += 120;
    expect(cueTableMinimumWidth(widths)).toBe(676);
    expect(defaultCueColumnWidths().style).toBe(88);
  });
});
