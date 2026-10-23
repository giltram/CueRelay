import { describe, expect, it } from 'vitest';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { deleteCue } from './delete-cue';

const first: Cue = { id: 'first', start_ms: 1000, end_ms: 2000, style: 'Default', text: 'first' };
const second: Cue = { ...first, id: 'second', start_ms: 3000, end_ms: 4000, style: 'Emphasis', text: 'second' };
const third: Cue = { ...first, id: 'third', start_ms: 5000, end_ms: 6000 };
const document: AssDocument = { source: 'original template', styles: ['Default', 'Emphasis'], cues: [third, first, second] };

describe('delete the current subtitle', () => {
  it('selects the next displayed row and preserves remaining ASS order and content', () => {
    const result = deleteCue(document, first.id);
    expect(result.document).toEqual({ ...document, cues: [third, second] });
    expect(result.selected).toBe(second);
    expect(document.cues).toEqual([third, first, second]);
  });
  it('selects the predecessor when deleting the last displayed row', () => {
    expect(deleteCue(document, third.id).selected).toBe(second);
  });
  it('returns no selection when deleting the sole row', () => {
    const result = deleteCue({ ...document, cues: [first] }, first.id);
    expect(result.document.cues).toEqual([]);
    expect(result.selected).toBeNull();
  });
  it('rejects a missing row without changing the document', () => {
    expect(() => deleteCue(document, 'missing')).toThrow('请先选择');
    expect(document.cues).toEqual([third, first, second]);
  });
});
