import { describe, expect, it } from 'vitest';
import { auditionRange } from './playback';

describe('audition ranges in milliseconds', () => {
  it.each([
    ['selection', 1000, 3000], ['before-start', 500, 1000], ['after-end', 3000, 3500],
    ['first-500', 1000, 1500], ['last-500', 2500, 3000],
  ] as const)('computes %s separately', (mode, start, end) => {
    expect(auditionRange(mode, 1000, 3000, 5000)).toEqual({ start, end });
  });

  it('keeps first/last auditions inside a selection shorter than 500ms', () => {
    for (const mode of ['first-500', 'last-500'] as const) {
      expect(auditionRange(mode, 1000, 1200, 5000)).toEqual({ start: 1000, end: 1200 });
    }
  });

  it('clips every range to the video without extending empty intersections', () => {
    expect(auditionRange('before-start', 100, 4900, 5000)).toEqual({ start: 0, end: 100 });
    expect(auditionRange('after-end', 100, 4900, 5000)).toEqual({ start: 4900, end: 5000 });
    expect(auditionRange('before-start', 0, 1000, 5000)).toBeNull();
    expect(auditionRange('after-end', 1000, 5000, 5000)).toBeNull();
    expect(auditionRange('selection', 4900, 5500, 5000)).toEqual({ start: 4900, end: 5000 });
    expect(auditionRange('first-500', 4900, 5500, 5000)).toEqual({ start: 4900, end: 5000 });
    expect(auditionRange('last-500', 4500, 5200, 5000)).toEqual({ start: 4700, end: 5000 });
    expect(auditionRange('selection', 5100, 5500, 5000)).toBeNull();
    expect(auditionRange('last-500', 5100, 5500, 5000)).toBeNull();
    expect(auditionRange('selection', 4900, 5500, 5000.5)).toEqual({ start: 4900, end: 5000.5 });
  });

  it('uses existing timing validation and requires a playable duration', () => {
    for (const [start, end] of [[1000, 1000], [3000, 1000], [-10, 1000], [1, 1000]]) {
      expect(() => auditionRange('selection', start, end, 5000)).toThrow();
    }
    for (const duration of [0, -1, NaN, Infinity]) {
      expect(() => auditionRange('selection', 1000, 3000, duration)).toThrow();
    }
  });
});
