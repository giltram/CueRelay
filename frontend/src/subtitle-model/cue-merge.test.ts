import { expect, it } from 'vitest';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { mergeCueLines } from './cue-merge';
import { orderCues } from './cue-order';
import { MAX_TIME_MS } from './timing';

function documentWith(...cues: Cue[]): AssDocument {
  return { schema_version: 2, source: 'ASS template', script: testScript, styles: [testStyle('Default'), testStyle('Other')], cues };
}

const first: Cue = { id: 'source-18', start_ms: 3000, end_ms: 4000, text: '{\\i1}Late\\Nline', style_id: 'Other' };
const early: Cue = { id: 'source-20', start_ms: 0, end_ms: 1000, text: 'Early', style_id: 'Default' };
const untouched: Cue = { id: 'source-19', start_ms: 1000, end_ms: 2000, text: 'Untouched', style_id: 'Default' };
const overlap: Cue = { id: 'source-21', start_ms: 3500, end_ms: 5000, text: 'Overlap', style_id: 'Default' };

it('merges nonconsecutive IDs by event order and keeps the first start, latest end, and first style', () => {
  const document = documentWith(first, untouched, early, overlap);
  expect(orderCues(document.cues).map(cue => cue.id)).toEqual([early.id, untouched.id, first.id, overlap.id]);
  const { document: result, cue } = mergeCueLines(document, [overlap.id, early.id, first.id]);
  expect(cue).toEqual({ ...first, end_ms: 5000, text: '{\\i1}Late\\Nline Early Overlap' });
  expect(result.cues).toEqual([cue, untouched]);
  expect(result.cues[1]).toBe(untouched);
  expect(result.styles).toBe(document.styles);
  expect(result.script).toBe(document.script);
  expect(result.source).toBe(document.source);
  expect(document.cues).toEqual([first, untouched, early, overlap]);
});

it('preserves whitespace, empty and repeated text, and does not close inline formatting', () => {
  const point = { ...first, start_ms: 0, end_ms: 0, text: '' };
  const second = { ...early, start_ms: 0, end_ms: 0, text: '{\\b1}same' };
  const third = { ...overlap, start_ms: 0, end_ms: 0, text: 'same  ' };
  const document = documentWith(point, second, { ...untouched, start_ms: 0, end_ms: 0, text: '' }, third);
  const { cue } = mergeCueLines(document, document.cues.map(line => line.id));
  expect(cue).toEqual({ ...point, text: ' {\\b1}same  same  ' });
});

it('keeps a new survivor’s source anchor and pasted ASS field overrides', () => {
  const metadata = { Layer: '3', Name: 'Actor', MarginL: '0010', MarginR: '0020', MarginV: '0030' };
  const added = { ...first, id: 'new-stable', source_id: first.id, ass_fields: metadata };
  const { cue } = mergeCueLines(documentWith(added, early), [added.id, early.id]);
  expect(cue).toEqual({ ...added, text: '{\\i1}Late\\Nline Early' });
  expect(cue.ass_fields).toBe(metadata);
});

it.each([
  { ids: [] }, { ids: [first.id] }, { ids: [first.id, first.id] }, { ids: [first.id, early.id, 'missing'] },
])('rejects an incomplete selection $ids', ({ ids }) => {
  const document = documentWith(first, early);
  expect(() => mergeCueLines(document, ids)).toThrow();
  expect(document.cues).toEqual([first, early]);
});

it('rejects invalid input timing before changing any cues and accepts the exact upper bound', () => {
  const invalid = { ...early, end_ms: MAX_TIME_MS + 10 };
  const document = documentWith(first, invalid);
  expect(() => mergeCueLines(document, [first.id, invalid.id])).toThrow();
  expect(document.cues).toEqual([first, invalid]);
  const boundary = documentWith(first, { ...early, end_ms: MAX_TIME_MS });
  expect(mergeCueLines(boundary, [first.id, early.id]).cue.end_ms).toBe(MAX_TIME_MS);
});
