import { expect, it } from 'vitest';
import { referenceGapOffsets, referenceIndexAt, referenceMeasuredOffsets, referenceOffsets, referenceWindow } from './window';

it('uses measured variable heights and estimates explicit/soft line breaks before mounting', () => {
  const rows = [{ key: 'a', text: 'short' }, { key: 'b', text: 'long\n' + 'x'.repeat(80) }];
  const offsets = referenceOffsets(rows, new Map([['a', { text: 'short', height: 40 }]]), 320);
  expect(offsets).toEqual([0, 40, 88.75]);
  expect(referenceIndexAt(offsets, 39)).toBe(0);
  expect(referenceIndexAt(offsets, 40)).toBe(1);
  expect(referenceIndexAt(offsets, 10000)).toBe(1);
  expect(referenceOffsets(rows, new Map(), 80)[2]).toBeGreaterThan(offsets[2]);
});

it('bounds the viewport and buffers while retaining an unmounted distant reveal/reading target', () => {
  const offsets = Array.from({ length: 5001 }, (_, index) => index * 20);
  const middle = referenceWindow(offsets, 50000, 100, [0, 4999, -1]);
  expect(middle).toContain(2500); expect(middle).toContain(0); expect(middle).toContain(4999);
  expect(middle.length).toBeLessThan(25);
  expect(referenceWindow([0], 0, 100)).toEqual([]);
  expect(referenceWindow([0, 20], 1000, 100)).toEqual([0]);
});

it('invalidates cached text heights and keeps estimates reusable between measured windows', () => {
  const estimates = new Map();
  const old = [{ key: 'a', text: 'old' }];
  referenceOffsets(old, new Map(), 320, estimates);
  const previous = estimates.get('a');
  referenceOffsets(old, new Map(), 320, estimates);
  expect(estimates.get('a')).toBe(previous);
  const rows = [{ key: 'a', text: 'new\ntext' }];
  expect(referenceOffsets(rows, new Map([['a', { text: 'old', height: 99 }]]), 320, estimates)).toEqual([0, 32.5]);
});

it('inserts/removes a gap before, between or after cues without changing their base offsets', () => {
  const offsets = [0, 20, 60];
  expect(referenceGapOffsets(offsets, -1, 16)).toBe(offsets);
  expect(referenceGapOffsets(offsets, 0, 16)).toEqual([0, 16, 36, 76]);
  expect(referenceGapOffsets(offsets, 1, 16)).toEqual([0, 20, 36, 76]);
  expect(referenceGapOffsets(offsets, 2, 16)).toEqual([0, 20, 60, 76]);
  expect(offsets).toEqual([0, 20, 60]);
});

it('applies measured height deltas without disturbing other row heights or previous geometry', () => {
  const before = [0, 20, 60, 80];
  expect(referenceMeasuredOffsets(before, [{ index: 0, height: 30 }, { index: 2, height: 50 }])).toEqual([0, 30, 70, 120]);
  expect(referenceMeasuredOffsets(before, [{ index: 1, height: 10 }])).toEqual([0, 20, 30, 50]);
  expect(before).toEqual([0, 20, 60, 80]);
});
