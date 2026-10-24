import { describe, expect, it } from 'vitest';
import { cueCps } from './cue-cps';

describe('subtitle characters per second', () => {
  const cps = (text: string, duration = 2000) => cueCps({ text, start_ms: 1000, end_ms: 1000 + duration });

  it('uses seconds and truncates fractional CPS', () => {
    expect(cps('你好世界')).toBe(2);
    expect(cps('你好世界啊')).toBe(2);
    expect(cps('你好世界', 500)).toBe(8);
  });

  it('ignores supported ASS style blocks, line breaks, whitespace and punctuation', () => {
    expect(cps('{\\i1}你，好！{\\i0}\\N世\\n界\\h。')).toBe(2);
    expect(cps(' A B\u3000C\u00a0D?!，。—')).toBe(2);
    expect(cps('{\\b1\\u1}AB{\\b0\\u0}CD')).toBe(2);
  });

  it('counts grapheme clusters instead of UTF-16 units', () => {
    expect(cps('e\u0301👨‍👩‍👧‍👦👍🏽中')).toBe(2);
  });

  it('shows zero for empty subtitles and text with no counted characters', () => {
    expect(cps('')).toBe(0);
    expect(cps('{\\i1}\\N\\h。！？ ')).toBe(0);
  });

  it('avoids invalid rates for zero, reversed or non-finite intervals', () => {
    for (const duration of [0, -100, NaN, Infinity]) expect(cps('你好', duration)).toBeNull();
    expect(cps('你好', 10)).toBe(200);
  });
});
