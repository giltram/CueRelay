import { expect, it } from 'vitest';
import { cueAnchorAfterRowsChange, cueAnchorScrollTop, cueIndexAtOffset, cueRevealScrollTop, cueWindowIndices, cueWindowOffsets } from './cue-window';

it('uses measured wrapping only for unchanged text, preserving full row order', () => {
  const cues = [{ id: 'a', text: 'long' }, { id: 'b', text: 'changed' }, { id: 'c', text: '' }];
  const heights = new Map([['a', { text: 'long', height: 95 }], ['b', { text: 'old', height: 70 }]]);
  const offsets = cueWindowOffsets(cues, heights);
  expect(offsets).toEqual([0, 95, 128, 161]);
  expect([0, 94, 95, 127, 128, 999].map(top => cueIndexAtOffset(offsets, top))).toEqual([0, 0, 1, 1, 2, 2]);
});

it('bounds mounted rows while retaining focus outside the scroll window', () => {
  const cues = Array.from({ length: 2000 }, (_, index) => ({ id: String(index), text: '' }));
  const offsets = cueWindowOffsets(cues, new Map());
  const indices = cueWindowIndices(offsets, 33000, 330, 2);
  expect(indices.length).toBeLessThan(30);
  expect(indices[0]).toBe(2);
  expect(indices).toContain(1000);
  expect(indices.at(-1)).toBe(1018);
  expect(cueWindowIndices([0], 0, 100, -1)).toEqual([]);
  expect(cueWindowIndices(offsets, 1e9, 330, -1).at(-1)).toBe(1999);
  expect(cueWindowIndices(offsets, 33000, 330, -1, [400, 400, -1, 3000])).toContain(400);
  expect(cueWindowIndices(offsets, 33000, 330, -1, [400, 400, -1, 3000]).filter(index => index === 400)).toHaveLength(1);
});

it('keeps the same reading row and inset after measuring preceding rows or reordering', () => {
  const rows = [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }];
  const anchor = { id: 'b', inset: 17 };
  expect(cueAnchorScrollTop(rows, [0, 33, 66, 99], anchor)).toBe(50);
  expect(cueAnchorScrollTop(rows, [0, 87, 174, 261], anchor)).toBe(104);
  expect(cueAnchorScrollTop([rows[1], rows[0]], [0, 87, 174], anchor)).toBe(17);
  expect(cueAnchorScrollTop([rows[0]], [0, 87], anchor)).toBeNull();
  expect(cueAnchorScrollTop(rows, [0, 20, 30, 63], anchor)).toBe(29);
});

it('reveals within the sticky-header viewport after each measurement, including tall rows', () => {
  expect(cueRevealScrollTop([0, 33, 66, 99], 1, 0, 90, 20)).toBe(0);
  expect(cueRevealScrollTop([0, 87, 174, 261], 1, 0, 140, 20)).toBe(54);
  expect(cueRevealScrollTop([0, 87, 174, 261], 1, 200, 140, 20)).toBe(87);
  expect(cueRevealScrollTop([0, 33, 433, 466], 1, 0, 140, 20)).toBe(33);
});

it('hands a deleted anchor to the next surviving row in the previous order, retaining its inset', () => {
  const previous = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
  const anchor = { id: 'b', inset: 20 };
  expect(cueAnchorAfterRowsChange(previous, previous, anchor)).toBe(anchor);
  expect(cueAnchorAfterRowsChange(previous, [previous[4], previous[0], previous[3]], anchor))
    .toEqual({ id: 'd', inset: 20 });
  // Inserting unrelated rows cannot make them a former neighbor of the deleted anchor.
  expect(cueAnchorAfterRowsChange(previous, [{ id: 'new' }, previous[2]], anchor))
    .toEqual({ id: 'c', inset: 20 });
});

it('falls back to the nearest surviving predecessor, or clears an anchor with no surviving neighbors', () => {
  const previous = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  expect(cueAnchorAfterRowsChange(previous, previous.slice(0, 2), { id: 'd', inset: 90 }))
    .toEqual({ id: 'b', inset: 90 });
  expect(cueAnchorScrollTop(previous.slice(0, 2), [0, 33, 66], { id: 'b', inset: 90 })).toBe(65);
  expect(cueAnchorAfterRowsChange(previous, [], { id: 'b', inset: 20 })).toBeNull();
  expect(cueAnchorAfterRowsChange(previous, [{ id: 'new' }], { id: 'b', inset: 20 })).toBeNull();
  expect(cueAnchorAfterRowsChange(previous, previous, { id: 'missing', inset: 20 })).toBeNull();
  expect(cueAnchorAfterRowsChange(previous, previous, null)).toBeNull();
});
