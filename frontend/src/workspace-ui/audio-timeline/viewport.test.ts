import { describe, expect, it } from 'vitest';
import { boundaryTime, clampViewport, timeAtX, zoomViewport } from './viewport';

describe('shared audio time coordinates', () => {
  it('clamps zoom and pan to video bounds, including short or absent media', () => {
    expect(clampViewport({ start: -1, span: 100 }, 120)).toEqual({ start: 0, span: 60 });
    expect(clampViewport({ start: 119, span: 10 }, 120)).toEqual({ start: 110, span: 10 });
    expect(clampViewport({ start: 0, span: 0.1 }, 120)).toEqual({ start: 0, span: 0.5 });
    expect(clampViewport({ start: 5, span: 10 }, 0.2)).toEqual({ start: 0, span: 0.2 });
    expect(clampViewport({ start: 5, span: 10 }, 0)).toEqual({ start: 0, span: 0 });
  });
  it('preserves the time under a zoom anchor', () => {
    const original = { start: 10, span: 20 };
    const zoomed = zoomViewport(original, 0.5, 0.3, 120);
    expect(timeAtX(30, 100, original)).toBeCloseTo(timeAtX(30, 100, zoomed));
  });
  it('maps click coordinates into the visible interval and clips edges', () => {
    expect(timeAtX(50, 100, { start: 20, span: 10 })).toBe(25);
    expect(timeAtX(-10, 100, { start: 20, span: 10 })).toBe(20);
    expect(timeAtX(110, 100, { start: 20, span: 10 })).toBe(30);
  });
  it('snaps dragged boundaries to the subtitle grid without exceeding a fractional media end', () => {
    expect(boundaryTime(1.234, 10000)).toBe(1230);
    expect(boundaryTime(-1, 10000)).toBe(0);
    expect(boundaryTime(12, 9996)).toBe(9990);
    expect(boundaryTime(36000, 36000000)).toBe(35_999_990);
  });
});
