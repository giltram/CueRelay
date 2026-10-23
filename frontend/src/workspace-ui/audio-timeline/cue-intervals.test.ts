import { describe, expect, it } from 'vitest';
import type { Cue } from '../../contracts/subtitles';
import { intervalPosition, visibleCueIntervals } from './cue-intervals';
import { xAtTime } from './viewport';

const cue = (id: string, start: number, end: number): Cue => ({ id, start_ms: start, end_ms: end, style: 'Default', text: '' });

describe('visible subtitle context', () => {
  it('projects an active draft with the same clipping rule, hiding invalid draft fills', () => {
    const view = { start: 2, span: 4 };
    expect(intervalPosition(1000, 4000, view)).toEqual({ left: 0, width: 50, startVisible: false, endVisible: true });
    expect(intervalPosition(3000, 5000, view)).toEqual({ left: 25, width: 50, startVisible: true, endVisible: true });
    expect(intervalPosition(4000, 4000, view)).toBeNull();
    expect(intervalPosition(5000, 4000, view)).toBeNull();
  });
  it('shows all other visible rows, sharing the active boundary coordinate transform', () => {
    const view = { start: 4.57, span: 4 };
    const intervals = visibleCueIntervals([cue('before', 5000, 5500), cue('active', 6000, 7000), cue('after', 7500, 8000)], 'active', view);
    expect(intervals.map(interval => interval.id)).toEqual(['before', 'after']);
    expect(intervals[0].left).toBe(xAtTime(5, 100, view));
    expect(intervals[0].width).toBeCloseTo(12.5);
    expect(intervals[1].left).toBe(xAtTime(7.5, 100, view));
  });
  it('clips ranges but never invents boundary lines at viewport edges', () => {
    const intervals = visibleCueIntervals([cue('left', 0, 3000), cue('right', 5000, 9000), cue('cover', 0, 9000)], null, { start: 2, span: 4 });
    expect(intervals).toEqual([
      { id: 'left', left: 0, width: 25, startVisible: false, endVisible: true },
      { id: 'right', left: 75, width: 25, startVisible: true, endVisible: false },
      { id: 'cover', left: 0, width: 100, startVisible: false, endVisible: false },
    ]);
  });
  it('omits offscreen, empty and inverted ranges, and handles absent media', () => {
    const cues = [cue('before', 0, 2000), cue('after', 6000, 8000), cue('empty', 3000, 3000), cue('inverted', 5000, 4000)];
    expect(visibleCueIntervals(cues, null, { start: 2, span: 4 })).toEqual([]);
    expect(visibleCueIntervals([cue('valid', 0, 1000)], null, { start: 0, span: 0 })).toEqual([]);
  });
  it('projects shared boundaries identically after scroll and zoom', () => {
    const cues = [cue('first', 1000, 2000), cue('second', 2000, 4000)];
    for (const view of [{ start: 0, span: 10 }, { start: 1.5, span: 3 }, { start: 1.9, span: 0.5 }]) {
      const [first, second] = visibleCueIntervals(cues, null, view);
      expect(first.left + first.width).toBeCloseTo(second.left);
      expect(second.left).toBe(xAtTime(2, 100, view));
    }
  });
});
