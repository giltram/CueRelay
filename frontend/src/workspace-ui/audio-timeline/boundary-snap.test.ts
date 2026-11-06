import { describe, expect, it } from 'vitest';
import { snapBoundaryTime, cueBoundaryMarkers } from './boundary-snap';
import type { Cue } from '../../contracts/subtitles';

const view = { start: 0, span: 10 };
const cue = (id: string, start_ms: number, end_ms: number): Cue => ({ id, start_ms, end_ms, text: '', style_id: 'style' });

describe('pointer boundary snapping', () => {
  it('uses the nearest marker within eight pixels, breaking ties toward the earlier time', () => {
    expect(snapBoundaryTime(2.07, 20000, view, 1000, [2000, 2100], false)).toBe(2100);
    expect(snapBoundaryTime(2.05, 20000, view, 1000, [2100, 2000], false)).toBe(2000);
    expect(snapBoundaryTime(2.08, 20000, view, 1000, [2000], false)).toBe(2000);
    expect(snapBoundaryTime(2.081, 20000, view, 1000, [2000], false)).toBe(2080);
  });
  it('scales the time radius with zoom and CSS width, independent of panning', () => {
    expect(snapBoundaryTime(2.06, 20000, { start: 1, span: 5 }, 1000, [2000], false)).toBe(2060);
    expect(snapBoundaryTime(2.06, 20000, { start: 1, span: 5 }, 500, [2000], false)).toBe(2000);
    expect(snapBoundaryTime(12.06, 20000, { start: 10, span: 10 }, 1000, [12000], false)).toBe(12000);
  });
  it('Shift bypasses marker snapping while preserving the ASS grid and media limits', () => {
    expect(snapBoundaryTime(2.064, 20000, view, 1000, [2000], true)).toBe(2060);
    expect(snapBoundaryTime(10, 9996, view, 1000, [10000], false)).toBe(9990);
    expect(snapBoundaryTime(-1, 20000, view, 1000, [], false)).toBe(0);
    expect(snapBoundaryTime(36000, 36000000, { start: 35990, span: 10 }, 1000, [36000000], false)).toBe(35_999_990);
  });
  it('excludes the active saved cue and offscreen endpoints without inventing clipped markers', () => {
    const markers = cueBoundaryMarkers([
      cue('selected', 1500, 2500), cue('before', 500, 1800), cue('after', 2900, 4000),
      cue('cover', 0, 5000), cue('edge', 1000, 3000),
    ], 'selected');
    expect(markers).toEqual([500, 1800, 2900, 4000, 0, 5000, 1000, 3000]);
    expect(snapBoundaryTime(1.01, 20000, { start: 1, span: 2 }, 100, [990, NaN, Infinity], false)).toBe(1010);
  });
  it('allows the opposite draft boundary as a target without changing interval validation', () => {
    expect(snapBoundaryTime(3.04, 20000, view, 1000, [3000], false)).toBe(3000);
    expect(snapBoundaryTime(3.04, 20000, view, 0, [3000], false)).toBe(3040);
  });
});
