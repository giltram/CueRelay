import { describe, expect, it } from 'vitest';
import type { Cue } from '../contracts/subtitles';
import { findCueMatches, matchCueText, navigateCueMatches } from './cue-search';

const cue = (id: string, start_ms: number, text = '命中', end_ms = start_ms + 1000): Cue =>
  ({ id, start_ms, end_ms, text, style_id: 'Default' });
const marked = (source: string, query: string) => matchCueText(source, query).map(range => source.slice(range.start, range.end));

describe('literal subtitle search', () => {
  it('finds Chinese, English case variants, literal metacharacters and every occurrence per row', () => {
    expect(marked('中文中文 abc ABC aBc .* [a]', '中文')).toEqual(['中文中文']);
    expect(marked('中文中文 abc ABC aBc .* [a]', 'AbC')).toEqual(['abc', 'ABC', 'aBc']);
    expect(marked('.* [a]', '.*')).toEqual(['.*']);
    expect(marked('ababa', 'aba')).toEqual(['ababa']);
    expect(findCueMatches([cue('a', 0, '中文 中文 中文')], '中文')).toHaveLength(1);
    expect(marked('🙂中🙂', '中🙂')).toEqual(['中🙂']);
  });

  it('ignores supported ASS blocks, crosses formatting boundaries and maps visible spaces to raw escapes', () => {
    const source = '{\\b1\\i1}你{\\i0}好{\\b0}\\N世界\\nHello\\hWORLD';
    const before = source;
    expect(marked(source, '你好 世界 hello world')).toEqual(['你', '好', '\\N世界\\nHello\\hWORLD']);
    expect(marked(source, 'b1')).toEqual([]);
    expect(marked(source, ' ')).toEqual(['\\N', '\\n', '\\h']);
    expect(source).toBe(before);
    expect(marked('{\\u1}a{\\s1}b{\\s0\\u0}', 'ab')).toEqual(['a', 'b']);
    // Invalid/incomplete drafts are literal; search never rewrites or validates them.
    expect(marked('{\\pos(1,2)}x {\\b', 'pos')).toEqual(['pos']);
    expect(marked('{\\b', '{\\b')).toEqual(['{\\b']);
    expect(marked('a  b', 'a b')).toEqual([]);
    expect(marked('a\\Nb', 'a\\Nb')).toEqual([]); // Query is ordinary visible text.
  });

  it('returns nothing for empty and missing queries without trimming literal whitespace', () => {
    expect(matchCueText('text', '')).toEqual([]);
    expect(findCueMatches([cue('a', 0)], '')).toEqual([]);
    expect(findCueMatches([cue('a', 0)], 'missing')).toEqual([]);
    expect(marked(' x ', ' ')).toHaveLength(2);
  });

  it('shares stable time ordering without changing document order', () => {
    const cues = [cue('late', 3000), cue('tie-first', 1000), cue('tie-second', 1000), cue('short', 1000, '命中', 1500)];
    expect(findCueMatches(cues, '命中').map(match => match.cueId)).toEqual(['short', 'tie-first', 'tie-second', 'late']);
    expect(cues.map(cue => cue.id)).toEqual(['late', 'tie-first', 'tie-second', 'short']);
  });

  it('derives changed, removed and reordered results from current cue identities', () => {
    const cues = [cue('a', 0), cue('b', 1000, 'other'), cue('c', 2000)];
    expect(findCueMatches(cues, '命中').map(match => match.cueId)).toEqual(['a', 'c']);
    const changed = [{ ...cues[0], text: 'other' }, { ...cues[1], text: '命中', start_ms: 4000 }, cues[2]];
    expect(findCueMatches(changed, '命中').map(match => match.cueId)).toEqual(['c', 'b']);
    expect(findCueMatches(changed.filter(cue => cue.id !== 'c'), '命中').map(match => match.cueId)).toEqual(['b']);
    expect(cues[0].text).toBe('命中');
  });
});

describe('cue ID search navigation', () => {
  const cues = [cue('last', 4000), cue('a', 0), cue('between', 1000, 'other'), cue('b', 2000), cue('c', 3000)];
  const matches = findCueMatches(cues, '命中');
  const go = (selected: string | null, current: string | null, direction: 'next' | 'previous') =>
    navigateCueMatches(cues, matches, selected, current, direction);

  it('starts inclusively at a selected result or on the appropriate side of a non-result', () => {
    expect(go('b', null, 'next')).toBe('b');
    expect(go('b', null, 'previous')).toBe('b');
    expect(go('between', null, 'next')).toBe('b');
    expect(go('between', null, 'previous')).toBe('a');
    expect(go(null, null, 'next')).toBe('a');
    expect(go(null, null, 'previous')).toBe('last');
    expect(go('deleted', null, 'next')).toBe('a');
  });

  it('wraps in both directions and advances by cursor identity after sorting', () => {
    expect(go('b', 'last', 'next')).toBe('a');
    expect(go('b', 'a', 'previous')).toBe('last');
    expect(go(null, 'b', 'next')).toBe('c');
    expect(go(null, 'b', 'previous')).toBe('a');
    const changed = cues.map(cue => cue.id === 'b' ? { ...cue, start_ms: 5000 } : cue);
    expect(navigateCueMatches(changed, findCueMatches(changed, '命中'), 'b', 'b', 'previous')).toBe('last');
  });

  it('wraps on initial navigation outside the result range and handles missing cursors/results', () => {
    const subset = matches.filter(match => match.cueId === 'b');
    expect(navigateCueMatches(cues, subset, 'last', null, 'next')).toBe('b');
    expect(navigateCueMatches(cues, subset, 'a', null, 'previous')).toBe('b');
    expect(go('b', 'removed', 'next')).toBe('b');
    expect(navigateCueMatches(cues, [], 'b', null, 'next')).toBeNull();
    expect(navigateCueMatches(cues, [], null, null, 'previous')).toBeNull();
  });
});
