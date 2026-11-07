import { describe, expect, it } from 'vitest';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { subtitleCharacterCount, visibleSubtitleText } from '../subtitle-model/text-statistics';
import { checkSubtitles } from './check-subtitles';

const cue = (patch: Partial<Cue> = {}): Cue => ({ id: 'new-one', start_ms: 1000, end_ms: 3000, text: '正常字幕', style_id: 'Default', ...patch });
const document = (...cues: Cue[]): AssDocument => ({ schema_version: 2, source: '', styles: ['Default', 'Other'].map(testStyle), script: testScript, cues });
const types = (doc: AssDocument) => checkSubtitles(doc).map(issue => issue.type);

describe('subtitle QC', () => {
  it('has no false positives for normal subtitles, supported formatting, or an empty project', () => {
    expect(checkSubtitles(document())).toEqual([]);
    expect(checkSubtitles(document(cue(), cue({ id: 'new-two', start_ms: 3200, end_ms: 5200, text: '{\\i1}第二条{\\i0}\\NHello' })), { videoDurationMs: 6000 })).toEqual([]);
  });
  it.each([[0, 0], [3000, 2000], [-10, 2000], [1001, 3000], [NaN, 3000], [0, Infinity], [0, 36_000_000]])('reports invalid interval %s–%s without meaningless duration or CPS', (start_ms, end_ms) => {
    expect(types(document(cue({ start_ms, end_ms })))).toEqual(['invalid-time']);
  });
  it('reports short/long duration and precise CPS with measured values', () => {
    const issues = checkSubtitles(document(cue({ end_ms: 1100, text: '这句话太快了' })));
    expect(issues.find(issue => issue.type === 'duration-short')?.measurements.durationMs).toBe(100);
    expect(issues.find(issue => issue.type === 'high-cps')?.measurements.cps).toBe(60);
    expect(types(document(cue({ end_ms: 9000 })))).toEqual(['duration-long']);
    expect(types(document(cue({ end_ms: 1500, text: '字'.repeat(10) })))).toEqual([]);
    const fractional = checkSubtitles(document(cue({ end_ms: 1990, text: '字'.repeat(20) })));
    expect(fractional.find(issue => issue.type === 'high-cps')?.measurements.cps).toBeCloseTo(20.202);
  });
  it('treats empty axes as editing info and export warning, never errors', () => {
    const doc = document(cue({ text: '{\\b1}\\N\\h　{\\b0}' }));
    expect(checkSubtitles(doc)).toMatchObject([{ type: 'empty-text', severity: 'info' }]);
    expect(checkSubtitles(doc, { phase: 'export' })).toMatchObject([{ type: 'empty-text', severity: 'warning' }]);
    expect(types(document(cue({ text: '！？' })))).toEqual([]);
  });
  it('allows touching cues, small overlaps and different-style overlays', () => {
    for (const next of [cue({ id: 'new-next', start_ms: 3000, end_ms: 5000 }),
      cue({ id: 'new-next', start_ms: 2900, end_ms: 4900 }),
      cue({ id: 'new-next', start_ms: 2500, end_ms: 4500 }), // exactly 25%
      cue({ id: 'new-next', start_ms: 1500, end_ms: 3500, style_id: 'Other' })]) {
      expect(types(document(cue(), next))).not.toContain('overlap');
    }
  });
  it('reports substantial same-style overlap as a warning, including nested intervals', () => {
    const issues = checkSubtitles(document(cue(), cue({ id: 'new-two', start_ms: 2000, end_ms: 4000 })));
    expect(issues.find(issue => issue.type === 'overlap')).toMatchObject({ cueIds: ['new-one', 'new-two'], severity: 'warning', measurements: { overlapMs: 1000, overlapRatio: .5 } });
    expect(types(document(cue({ end_ms: 6000 }), cue({ id: 'new-two', start_ms: 2000, end_ms: 3000 })))).toContain('overlap');
  });
  it('uses known video duration without clipping subtitles, ignoring unknown duration', () => {
    const doc = document(cue());
    expect(checkSubtitles(doc, { videoDurationMs: 2500 })).toMatchObject([{ type: 'outside-video', severity: 'warning', measurements: { excessMs: 500 } }]);
    for (const videoDurationMs of [null, 0, NaN, Infinity]) expect(checkSubtitles(doc, { videoDurationMs })).toEqual([]);
    expect(doc.cues[0].end_ms).toBe(3000);
  });
  it('counts Chinese, English, line breaks, ASS blocks, punctuation, emoji and combining sequences', () => {
    expect(subtitleCharacterCount('你好世界')).toBe(4);
    expect(subtitleCharacterCount('Hello, world!')).toBe(10);
    expect(subtitleCharacterCount('{\\b1\\i1}你{\\b0}好\\N世\\n界\\h！')).toBe(4);
    expect(subtitleCharacterCount('e\u0301👨‍👩‍👧‍👦👍🏽中')).toBe(4);
    expect(visibleSubtitleText('a\\Nb\\nc\\hd')).toBe('a b c d');
  });
  it('flags long text at a centralized configurable threshold', () => {
    expect(types(document(cue({ text: '字'.repeat(81), end_ms: 6000 })))).toContain('text-long');
    expect(checkSubtitles(document(cue({ text: '字'.repeat(26) })), { thresholds: { maximumCharacters: 25 } })).toMatchObject([{ type: 'text-long', measurements: { characters: 26 } }]);
  });
  it('only warns about nearby exact visible repeats with the same style', () => {
    const first = cue({ text: '{\\i1}你好{\\i0}\\N世界' });
    expect(types(document(first, cue({ id: 'new-next', start_ms: 3000, end_ms: 5000, text: '你好 世界' })))).toContain('repeated-text');
    for (const patch of [{ start_ms: 4010, end_ms: 6010 }, { style_id: 'Other' }, { text: '你好，世界' }, { text: '你好 WORLD' }]) {
      expect(types(document(first, cue({ id: 'new-next', start_ms: 3000, end_ms: 5000, text: '你好 世界', ...patch })))).not.toContain('repeated-text');
    }
  });
  it('reports missing styles and merges actual codec failures without duplicate rules', () => {
    const doc = document(cue({ style_id: 'missing' }));
    const issues = checkSubtitles(doc, { formatIssues: [{ code: 'unsupported_or_invalid_ass', type: 'missing-style', cue_id: 'new-one', message: '样式不存在' }] });
    expect(issues).toHaveLength(1); expect(issues[0].severity).toBe('error');
    expect(checkSubtitles(document(cue()), { formatIssues: [{ code: 'unsupported_or_invalid_ass', type: 'unsupported-ass', cue_id: 'new-one', message: '不支持的标签' }] })).toMatchObject([{ type: 'unsupported-ass', cueIds: ['new-one'] }]);
    expect(checkSubtitles(document(), { formatIssues: [{ code: 'unsupported_or_invalid_ass', type: 'unsupported-ass', message: '文档超限', line: 8 }] })).toMatchObject([{ cueIds: [], measurements: { sourceLine: 8 } }]);
  });
  it('uses stable cue IDs after sorting and reflects immutable edits and deletions immediately', () => {
    const short = cue({ end_ms: 1100, text: '快' }), doc = document(short);
    const before = structuredClone(doc), issue = checkSubtitles(doc)[0];
    expect(checkSubtitles(document(cue({ id: 'new-earlier', start_ms: 0, end_ms: 800 }), short)).find(next => next.type === issue.type)?.id).toBe(issue.id);
    expect(checkSubtitles(document({ ...short, end_ms: 3000 }))).toEqual([]);
    expect(checkSubtitles(document())).toEqual([]);
    expect(doc).toEqual(before);
  });
  it('handles 5000 subtitles without mutating or reordering the snapshot', () => {
    const cues = Array.from({ length: 5000 }, (_, index) => cue({ id: `new-${index}`, start_ms: index * 2500, end_ms: index * 2500 + 2000, text: `字幕 ${index}` })).reverse();
    const doc = document(...cues), first = doc.cues[0];
    expect(checkSubtitles(doc)).toEqual([]);
    expect(doc.cues[0]).toBe(first);
  });
});
