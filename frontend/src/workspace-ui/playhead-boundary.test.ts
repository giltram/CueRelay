import { describe, expect, it } from 'vitest';
import { playheadBoundary } from './playhead-boundary';

const cue = { id: 'source-1', start_ms: 10000, end_ms: 16000, text: '保留', style_id: 'Default' };
describe('playhead endpoint edits', () => {
  it('changes only the requested endpoint on the existing time grid', () => {
    expect(playheadBoundary(cue, 'start', 13.004)).toEqual({ ...cue, start_ms: 13000 });
    expect(playheadBoundary(cue, 'end', 13.006)).toEqual({ ...cue, end_ms: 13010 });
    expect(cue.start_ms).toBe(10000);
    expect(cue.end_ms).toBe(16000);
  });
  it.each([['start', 16], ['start', 17], ['end', 10], ['end', 9], ['start', -1], ['end', NaN], ['end', 36000]] as const)(
    'rejects %s at %s without mutation', (point, seconds) => {
      expect(() => playheadBoundary(cue, point, seconds)).toThrow();
      expect(cue).toEqual({ id: 'source-1', start_ms: 10000, end_ms: 16000, text: '保留', style_id: 'Default' });
    },
  );
});
