import { describe, expect, it, vi } from 'vitest';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { initializeDocument } from './cue-defaults';
import { commitTiming } from './commit-timing';

describe('default subtitle for an empty editor', () => {
  const empty: AssDocument = { source: 'ASS template', styles: ['Emphasis', 'Default'], cues: [] };

  it('creates exactly one 0–2 second empty row in the document default style', () => {
    const document = initializeDocument(empty, () => 'initial');
    expect(document).toEqual({ ...empty, cues: [{ id: 'initial', start_ms: 0, end_ms: 2000, text: '', style: 'Emphasis' }] });
    expect(empty.cues).toEqual([]);
    expect(document.source).toBe(empty.source);
    expect(document.styles).toBe(empty.styles);
  });

  it('preserves imported rows, including intentionally zero-length rows', () => {
    const row: Cue = { id: 'existing', start_ms: 1000, end_ms: 1000, text: '', style: 'Default' };
    const imported = { ...empty, cues: [row] };
    const createId = vi.fn();
    expect(initializeDocument(imported, createId)).toBe(imported);
    expect(createId).not.toHaveBeenCalled();
  });

  it('does not duplicate a default row when initialized again', () => {
    const document = initializeDocument(empty, () => 'initial');
    expect(initializeDocument(document, () => 'unused')).toBe(document);
  });

  it('commits the selected default row and prepares only the following two-second row', () => {
    const document = initializeDocument(empty, () => 'initial');
    const result = commitTiming(document, 'initial', 1200, 2400, () => 'next');
    expect(result.document.cues).toEqual([
      { id: 'initial', start_ms: 1200, end_ms: 2400, text: '', style: 'Emphasis' },
      { id: 'next', start_ms: 2400, end_ms: 4400, text: '', style: 'Emphasis' },
    ]);
    expect(result.selected.id).toBe('next');
  });
});
