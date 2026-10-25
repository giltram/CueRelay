import { testStyle, testScript } from '../contracts/subtitles.test-fixtures';
import { expect, it } from 'vitest';
import { previewDocument } from './preview-document';
import type { AssDocument } from '../contracts/subtitles';
const doc: AssDocument = { source: 'original styles and PlayRes', styles: ['Default', 'Other'].map(testStyle), schema_version: 2, script: testScript, cues: [
  { id: 'source-1', text: '中文\\N{\\i1}字幕', style_id: 'Other', start_ms: 1000, end_ms: 3000 },
  { id: 'new-split', source_id: 'source-1', text: 'overlap', style_id: 'Default', start_ms: 2000, end_ms: 4000 },
] };
it('projects timing without committing, preserving style, source, order and split metadata', () => {
  const result = previewDocument(doc, 'source-1', '0:00:01.23', '0:00:05.67');
  expect(result.document?.cues[0]).toEqual({ ...doc.cues[0], start_ms: 1230, end_ms: 5670 });
  expect(result.document?.cues[1]).toBe(doc.cues[1]);
  expect(result.document?.source).toBe(doc.source);
  expect(result.document?.styles).toBe(doc.styles);
  expect(doc.cues[0].end_ms).toBe(3000);
});
it('retains original timing while a time draft is partial, inverted or out of range', () => {
  for (const [start, end] of [['0:', '0:00:03.00'], ['0:00:03.00', '0:00:03.00'], ['0:00:04.00', '0:00:03.00'], ['10:00:00.00', '10:00:01.00']]) {
    const result = previewDocument(doc, 'source-1', start, end);
    expect(result.document).toBe(doc); expect(result.warning).toBeTruthy();
  }
});
it('preserves identity on selection without edits, deletion, and remote replacement', () => {
  expect(previewDocument(doc, 'source-1', '0:00:01.00', '0:00:03.00').document).toBe(doc);
  expect(previewDocument(doc, 'deleted-id', 'bad', 'bad').document).toBe(doc);
  const remote = { ...doc, cues: [] };
  expect(previewDocument(remote, null, 'bad', 'bad').document).toBe(remote);
});
