import { describe, expect, it } from 'vitest';
import { insertTranslation } from './term-insertion';
import { createHistory, record, redo, undo } from './edit-history';
import type { EditState } from './edit-history';

describe('glossary translation insertion', () => {
  it('uses the most recent caret/selection and appends without a current row selection', () => {
    expect(insertTranslation('甲乙', 'a', '人名', { cueId: 'a', start: 1, end: 1 })).toEqual({ text: '甲人名乙', cursor: 3 });
    expect(insertTranslation('甲乙丙', 'a', '人名', { cueId: 'a', start: 1, end: 3 }).text).toBe('甲人名');
    expect(insertTranslation('甲乙', 'a', '译名', null).text).toBe('甲乙译名');
    expect(insertTranslation('甲乙', 'b', '译名', { cueId: 'a', start: 0, end: 2 }).text).toBe('甲乙译名');
    expect(insertTranslation('甲', 'a', '名', { cueId: 'a', start: 0, end: 5 }).text).toBe('甲名');
  });
  it('preserves UTF-16 offsets and treats glossary content as ordinary text', () => {
    expect(insertTranslation('😀人', 'a', '<b>{\\b1}', { cueId: 'a', start: 2, end: 3 })).toEqual({ text: '😀<b>{\\b1}', cursor: 10 });
  });
  it('normalizes multiline names exactly at the subtitle edit boundary', () => {
    expect(insertTranslation('甲乙', 'a', '一\r\n二\n三', { cueId: 'a', start: 1, end: 1 }))
      .toEqual({ text: '甲一\\N二\\N三乙', cursor: 8 });
  });
  it('records one reversible subtitle change without changing timing drafts', () => {
    const before = { document: { cues: [{ id: 'a', text: '旧' }] }, selectedId: 'a', startText: '0:', endText: '' } as EditState;
    const after = { ...before, document: { ...before.document!, cues: [{ ...before.document!.cues[0], text: '旧人名' }] } };
    const history = record(createHistory(before), after);
    expect(undo(history).present).toEqual(before);
    expect(redo(undo(history)).present).toEqual(after);
  });
});
