import { describe, expect, it } from 'vitest';
import { clampMediaWidth, defaultMediaWidth, maximumMediaWidth, mediaWidthBounds, requiredWorkbenchHeight } from './workbench-sizing';

describe('workbench resizing constraints', () => {
  it('reserves default transport width when the video frame is height-limited', () => {
    expect(defaultMediaWidth(1366, .44, 334)).toBe(400);
    expect(defaultMediaWidth(950, .38, 421)).toBe(400);
    expect(defaultMediaWidth(1366, .44, 487)).toBe(487);
    expect(defaultMediaWidth(820, .38, 334)).toBe(340);
    expect(mediaWidthBounds(950, 421).minimum).toBe(300);
  });
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
  it('preserves the default frame-to-column gap through small and repeated resizing', () => {
    const chrome = 154, initialHeight = 342, initialWidth = 400;
    const gap = initialWidth - (initialHeight - chrome) * 16 / 9;
    expect(requiredWorkbenchHeight(initialWidth, chrome, gap)).toBeCloseTo(initialHeight);
    expect(requiredWorkbenchHeight(initialWidth - 1, chrome, gap)).toBeCloseTo(initialHeight - 9 / 16);
    expect(requiredWorkbenchHeight(initialWidth + 2, chrome, gap)).toBeCloseTo(initialHeight + 2 * 9 / 16);
    const maximum = maximumMediaWidth(540, 144, 4, chrome);
    const bounds = mediaWidthBounds(1366, maximum, gap);
    expect(bounds.maximum).toBeCloseTo(maximum + gap);
    expect(requiredWorkbenchHeight(bounds.maximum, chrome, gap)).toBeCloseTo(540 - 144 - 4);
    expect(mediaWidthBounds(900, maximum, gap).maximum).toBe(420);
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
