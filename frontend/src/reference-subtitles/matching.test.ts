import { expect, it } from 'vitest';
import { matchReference, orderReference, referenceContext } from './matching';
const cue = (start_ms: number, end_ms: number, text = '') => ({ start_ms, end_ms, text });
const interval = (start_ms: number, end_ms = start_ms) => ({ start_ms, end_ms });

it('sorts stably without mutating source and retains all overlaps, empty and duplicate blocks', () => {
  const source = [cue(3000, 4000, 'after'), cue(1000, 2500, 'one'), cue(1000, 2500, ''), cue(0, 900, 'before'), cue(2000, 2000, 'point')];
  const ordered = orderReference(source);
  const result = matchReference(ordered, interval(1500, 2500));
  expect(result.matches.map(c => c.text)).toEqual(['one', '', 'point']);
  expect(result.before?.text).toBe('before'); expect(result.after?.text).toBe('after');
  expect(source[0].text).toBe('after');
});

it('uses exact milliseconds and half-open boundaries, with explicit zero duration point matches', () => {
  const ordered = orderReference([cue(1231, 1234, 'short'), cue(1234, 1235, 'next'), cue(1234, 1234, 'zero')]);
  expect(matchReference(ordered, interval(1233)).matches.map(c => c.text)).toEqual(['short']);
  expect(matchReference(ordered, interval(1234)).matches.map(c => c.text)).toEqual(['zero', 'next']);
  expect(matchReference(ordered, interval(1231, 1234)).matches.map(c => c.text)).toEqual(['short']);
  expect(matchReference(ordered, interval(1235)).matches).toEqual([]);
});

it('marks gaps as unmatched with closest ended and upcoming context, including empty collections', () => {
  const ordered = orderReference([cue(0, 200, 'long'), cue(50, 100, 'short'), cue(500, 600, 'next')]);
  const gap = matchReference(ordered, interval(300, 400));
  expect(gap.matches).toEqual([]); expect(gap.before?.text).toBe('long'); expect(gap.after?.text).toBe('next');
  expect(matchReference(ordered, interval(0)).before).toBeUndefined();
  expect(matchReference(ordered, interval(700)).after).toBeUndefined();
  expect(matchReference([], interval(1))).toEqual({ matches: [], before: undefined, after: undefined });
});

it('prefers real audition time, then running video, and returns to selected editing interval when stopped', () => {
  const selected = interval(1000, 2000);
  expect(referenceContext(selected, 7000, true, true, 3500.5)).toEqual(interval(3500.5));
  expect(referenceContext(selected, 7000, true, false, 4000)).toEqual(interval(7000));
  expect(referenceContext(selected, 7000, false, false, 4000)).toBe(selected);
  expect(referenceContext(selected, 7000, false, true, null)).toBe(selected);
  expect(referenceContext(undefined, 0, false, false, null)).toEqual(interval(0));
  expect(referenceContext(undefined, 7000, false, false, 4000)).toEqual(interval(7000));
});
