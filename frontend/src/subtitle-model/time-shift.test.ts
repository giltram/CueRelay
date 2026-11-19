import { expect, it } from 'vitest';
import type { AssDocument } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { orderCues } from './cue-order';
import { shiftCueTimes } from './time-shift';
import { MAX_TIME_MS } from './timing';

const document: AssDocument = {
  schema_version: 2, source: 'original ASS template', script: testScript, styles: [testStyle('Default'), testStyle('Other')],
  cues: [
    { id: 'late', start_ms: 900, end_ms: 1200, text: 'Late', style_id: 'Other', source_id: 'source-late' },
    { id: 'early', start_ms: 100, end_ms: 300, text: 'Early\\Nline', style_id: 'Default',
      ass_fields: { Layer: '3', Name: 'Speaker', MarginL: '0010', MarginR: '0020', MarginV: '0030' } },
    { id: 'point', start_ms: 200, end_ms: 200, text: '', style_id: 'Default' },
  ],
};

it('shifts selected cues by the same amount while retaining fields, duration and event order', () => {
  const result = shiftCueTimes(document, new Set(['early', 'point']), 1000);
  expect(result).toEqual({ document: { ...document, cues: [
    document.cues[0],
    { ...document.cues[1], start_ms: 1100, end_ms: 1300 },
    { ...document.cues[2], start_ms: 1200, end_ms: 1200 },
  ] } });
  if (!('document' in result)) throw new Error(result.reason);
  expect(result.document.cues[0]).toBe(document.cues[0]);
  expect(result.document.cues[1].ass_fields).toBe(document.cues[1].ass_fields);
  expect(result.document.script).toBe(document.script);
  expect(result.document.styles).toBe(document.styles);
  expect(orderCues(result.document.cues).map(cue => cue.id)).toEqual(['late', 'early', 'point']);
  expect(document.cues.map(cue => cue.start_ms)).toEqual([900, 100, 200]);
});

it('shifts the whole document earlier and accepts exact endpoints of the ASS time range', () => {
  expect(shiftCueTimes(document, 'all', -100)).toEqual({ document: { ...document, cues: [
    { ...document.cues[0], start_ms: 800, end_ms: 1100 },
    { ...document.cues[1], start_ms: 0, end_ms: 200 },
    { ...document.cues[2], start_ms: 100, end_ms: 100 },
  ] } });
  const latest = shiftCueTimes(document, new Set(['late']), MAX_TIME_MS - 1200);
  expect(latest).toMatchObject({ document: { cues: [{ end_ms: MAX_TIME_MS }, document.cues[1], document.cues[2]] } });
});

it('returns a failure for the entire batch when a later cue would cross either bound', () => {
  const withMaxEnd = { ...document, cues: [...document.cues,
    { ...document.cues[0], id: 'max', start_ms: MAX_TIME_MS - 10, end_ms: MAX_TIME_MS }] };
  expect(shiftCueTimes(withMaxEnd, 'all', -110)).toEqual({ reason: 'out-of-range' });
  expect(shiftCueTimes(withMaxEnd, 'all', 10)).toEqual({ reason: 'out-of-range' });
  expect(withMaxEnd.cues.map(cue => cue.start_ms)).toEqual([900, 100, 200, MAX_TIME_MS - 10]);
});

it.each([5, -0.5, Infinity, NaN, 1e20])('rejects the non-grid or unsafe offset %s', offset => {
  expect(shiftCueTimes(document, 'all', offset)).toEqual({ reason: 'invalid-offset' });
});

it('validates resulting intervals and keeps the original reference for zero or an empty selection', () => {
  const invalid = { ...document, cues: [{ ...document.cues[0], end_ms: 800 }] };
  expect(shiftCueTimes(invalid, 'all', 10)).toEqual({ reason: 'invalid-interval' });
  for (const result of [shiftCueTimes(document, 'all', 0), shiftCueTimes(document, new Set(), 10)]) {
    expect(result).toHaveProperty('document');
    expect('document' in result && result.document).toBe(document);
  }
});
