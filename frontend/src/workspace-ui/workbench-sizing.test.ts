import { describe, expect, it } from 'vitest';
import { clampMediaWidth, mediaWidthBounds } from './workbench-sizing';

describe('workbench resizing constraints', () => {
  it('keeps both panes usable when the editor is the limiting side', () => {
    const bounds = mediaWidthBounds(900, 800);
    expect(bounds).toEqual({ minimum: 300, maximum: 420 });
    expect(clampMediaWidth(0, bounds)).toBe(300);
    expect(clampMediaWidth(1000, bounds)).toBe(420);
    expect(clampMediaWidth(360, bounds)).toBe(360);
  });
  it('stops growing when a 16:9 video would exceed the available height', () => {
    expect(mediaWidthBounds(1400, 640)).toEqual({ minimum: 300, maximum: 640 });
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
