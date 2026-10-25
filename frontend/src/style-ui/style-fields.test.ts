import { expect, it } from 'vitest';
import type { AssDocument } from '../contracts/subtitles';
import { assColor, chosenFields, replaceRgb, sampleStyleDocument, uniqueStyleName } from './style-fields';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { documentV2 } from '../project-data/document-version';

it('maps ASS ABGR and preserves transparency when changing an RGB picker', () => {
  expect(assColor('&H80332211')).toEqual({ rgb: '#112233', alpha: 128 });
  expect(replaceRgb('&H80332211', '#ff00aa')).toBe('&H80AA00FF');
  expect(assColor('rgba(1,2,3,1)')).toBeNull();
  expect(assColor('&HFF0000')).toBeNull();
});
it('sends only selected batch properties, preserving each character color', () => {
  const fields = testStyle('A').fields;
  expect(chosenFields(fields, ['Fontsize', 'Outline'])).toEqual({ Fontsize: '28', Outline: '2' });
  expect(chosenFields(fields, [])).toEqual({});
  expect(fields.PrimaryColour).toBe('&H00FFFFFF');
});
it('projects a preview without changing cues, styles, script or metadata in the editor', () => {
  const style = testStyle('A');
  const original: AssDocument = { schema_version: 2, source: 'metadata', styles: [style, testStyle('B')], script: testScript,
    cues: [{ id: 'original', source_id: 'source-1', start_ms: 1000, end_ms: 2000, style_id: style.id, text: '原字幕' }] };
  const before = structuredClone(original);
  const preview = sampleStyleDocument(original, style, { ...style.fields, Fontsize: '60' });
  expect(original).toEqual(before);
  expect(preview.source).toBe(original.source);
  expect(preview.styles[1]).toBe(original.styles[1]);
  expect(preview.cues).toHaveLength(1);
  expect(preview.cues[0].style_id).toBe(style.id);
  expect(preview.styles[0].fields.Fontsize).toBe('60');
});
it('suggests noncolliding names within the server length limit', () => {
  expect(uniqueStyleName('A', [{ name: 'A' }, { name: 'A (2)' }])).toBe('A (3)');
  expect(uniqueStyleName('甲'.repeat(100), [{ name: '甲'.repeat(100) }]).length).toBeLessThanOrEqual(100);
});
it('rejects old snapshots explicitly before an editor can consume them', () => {
  expect(() => documentV2({ source: 'ASS', styles: ['Default'], cues: [] })).toThrow('v2');
});
