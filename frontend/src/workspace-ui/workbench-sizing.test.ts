import { describe, expect, it } from 'vitest';
import { clampMediaWidth, maximumMediaWidth, mediaWidthBounds, requiredWorkbenchHeight } from './workbench-sizing';

describe('workbench resizing constraints', () => {
  it('keeps both panes usable when the editor is the limiting side', () => {
    const bounds = mediaWidthBounds(900, 800);
    expect(bounds).toEqual({ minimum: 300, maximum: 420 });
    expect(clampMediaWidth(0, bounds)).toBe(300);
    expect(clampMediaWidth(1000, bounds)).toBe(420);
    expect(clampMediaWidth(360, bounds)).toBe(360);
  });
  it('stops growing when a 16:9 video would exhaust the height budget', () => {
    expect(mediaWidthBounds(1400, 640)).toEqual({ minimum: 300, maximum: 640 });
  });
  it('allows growth beyond the initial video height while reserving the subtitle minimum', () => {
    const maximum = maximumMediaWidth(832, 144, 12, 122);
    expect(maximum).toBeCloseTo(984.889);
    expect(maximum).toBeGreaterThan((434 - 122) * 16 / 9);
    expect(requiredWorkbenchHeight(maximum, 122)).toBe(676);
    expect(832 - requiredWorkbenchHeight(maximum, 122) - 12).toBe(144);
  });
  it('shrinks the height budget with the viewport and leaves the editor usable', () => {
    const maximum = maximumMediaWidth(632, 144, 12, 122);
    expect(requiredWorkbenchHeight(maximum, 122)).toBe(476);
    expect(mediaWidthBounds(1382, maximum).maximum).toBeCloseTo(629.333);
    expect(mediaWidthBounds(1382, maximum).maximum).toBeLessThan(1382 - 480);
    expect(maximumMediaWidth(100, 144, 12, 122)).toBe(0);
  });
  it('reclamps the saved proportion after a window resize', () => {
    const share = 600 / 1400;
    expect(clampMediaWidth(900 * share, mediaWidthBounds(900, 800))).toBeCloseTo(385.714);
    expect(clampMediaWidth(800 * share, mediaWidthBounds(800, 800))).toBe(320);
  });
  it('keeps bounds ordered when space is temporarily unavailable at a breakpoint', () => {
    expect(mediaWidthBounds(700, 100)).toEqual({ minimum: 220, maximum: 220 });
    expect(mediaWidthBounds(0, 0)).toEqual({ minimum: 0, maximum: 0 });
  });
});
