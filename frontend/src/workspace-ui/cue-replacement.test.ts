import { expect, it } from 'vitest';
import type { AssDocument } from '../contracts/subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import { replaceCueText, type ReplaceCueRequest } from './cue-replacement';

function makeDocument(...texts: string[]): AssDocument {
  return {
    schema_version: 2, source: 'original ASS template', script: testScript, styles: [testStyle('Default')],
    cues: texts.map((text, index) => ({
      id: `new-${index}`, start_ms: (texts.length - index) * 100, end_ms: (texts.length - index) * 100 + 50, text,
      style_id: 'Default', source_id: 'source-7', ass_fields: { Layer: '3', Name: 'Speaker', MarginL: '1', MarginR: '2', MarginV: '3' },
    })),
  };
}

function replace(document: AssDocument, query: string, replacement: string, target: ReplaceCueRequest['target'] = 'all') {
  return replaceCueText(document, { query, replacement, target });
}

it('preserves static override bytes and reset boundaries when replacing across tags', () => {
  const before = makeDocument('{\\an7\\pos(20,30)\\c&HFF&\\alpha&H80&}甲{\\1a&H00&}乙{\\r}丙');
  const result = replace(before, '甲乙', '新');
  expect(result).toEqual({ count: 1, document: { ...before, cues: [{ ...before.cues[0],
    text: '{\\an7\\pos(20,30)\\c&HFF&\\alpha&H80&}新{\\1a&H00&}{\\r}丙' }] } });
  expect(replace(before, 'FF', '00')).toEqual({ document: before, count: 0 });
});

it('edits only the current occurrence including an overlapping candidate', () => {
  const before = makeDocument('ababa aba', 'ABA');
  const result = replace(before, 'ABA', 'X', { cueId: 'new-0', source: 'ababa aba', start: 2 });
  expect(result).toEqual({
    document: { ...before, cues: [{ ...before.cues[0], text: 'abX aba' }, before.cues[1]] }, count: 1,
  });
  expect(replace(before, 'aba', 'X', { cueId: 'new-0', source: 'old source', start: 2 })).toEqual({ reason: 'stale-match' });
  expect(replace(before, 'aba', 'X', { cueId: 'new-0', source: 'ababa aba', start: 1 })).toEqual({ reason: 'stale-match' });
  expect(replace(before, 'aba', 'X', { cueId: 'deleted', source: 'ababa aba', start: 0 })).toEqual({ reason: 'stale-match' });
});

it('replaces adjacent but non-overlapping matches from the snapshot, with no recursive insertion', () => {
  const before = makeDocument('ababaABA', '🙂中🙂中', 'other');
  const result = replace(before, 'aba', 'aba!');
  expect(result).toEqual({ document: { ...before, cues: [{ ...before.cues[0], text: 'aba!baaba!' }, ...before.cues.slice(1)] }, count: 2 });
  expect(replace(before, '🙂中', '')).toEqual({
    document: { ...before, cues: [before.cues[0], { ...before.cues[1], text: '' }, before.cues[2]] }, count: 2,
  });
  if (!('document' in result)) throw new Error(result.reason);
  expect(result.document.cues[0].ass_fields).toBe(before.cues[0].ass_fields);
  expect(result.document.cues[1]).toBe(before.cues[1]);
  expect(result.document.styles).toBe(before.styles);
  expect(result.document.script).toBe(before.script);
  expect(before.cues.map(cue => cue.text)).toEqual(['ababaABA', '🙂中🙂中', 'other']);
  const adjacent = makeDocument('aAaA', 'Ä');
  expect(replace(adjacent, 'AA', '!')).toEqual({
    document: { ...adjacent, cues: [{ ...adjacent.cues[0], text: '!!' }, adjacent.cues[1]] }, count: 2,
  });
  expect(replace(adjacent, 'ä', '!')).toEqual({ document: adjacent, count: 0 });
});

it('inserts all new text at the first match character and keeps the existing tag bytes in order', () => {
  const before = makeDocument('前{\\i1}你{\\b1}好{\\b0\\i0}后', '你{\\b1}好{\\b0}');
  expect(replace(before, '你好', '早安🌅')).toEqual({
    document: { ...before, cues: [{ ...before.cues[0], text: '前{\\i1}早安🌅{\\b1}{\\b0\\i0}后' },
      { ...before.cues[1], text: '早安🌅{\\b1}{\\b0}' }] }, count: 2,
  });
  expect(replace(before, '你好', '你好')).toEqual({ document: before, count: 0 });
});

it('matches each ASS whitespace escape as a whole and encodes actual replacement line breaks', () => {
  const before = makeDocument('a\\Nb\\nc\\hd 🙂');
  expect(replace(before, ' ', '·')).toEqual({
    document: { ...before, cues: [{ ...before.cues[0], text: 'a·b·c·d·🙂' }] }, count: 4,
  });
  expect(replace(before, 'b c', '甲\r\n乙\n丙\r丁')).toEqual({
    document: { ...before, cues: [{ ...before.cues[0], text: 'a\\N甲\\N乙\\N丙\\N丁\\hd 🙂' }] }, count: 1,
  });
  const same = makeDocument('a\\Nb');
  expect(replace(same, ' ', '\n')).toEqual({ document: same, count: 0 });
});

it('preserves identity with no actual change, counts case-only edits, and never matches across cues', () => {
  const before = makeDocument('aA', 'b');
  for (const query of ['', 'ab', 'missing']) {
    const result = replace(before, query, 'x');
    expect(result).toEqual({ document: before, count: 0 });
    if ('document' in result) expect(result.document).toBe(before);
  }
  expect(replace(before, 'a', 'a')).toEqual({ document: { ...before, cues: [{ ...before.cues[0], text: 'aa' }, before.cues[1]] }, count: 1 });
});

it('rejects unsupported literals and accidental syntax even after preparing earlier rows', () => {
  const before = makeDocument('x', '\\x');
  for (const replacement of ['{}', '\\N', '\\', '{\\b1}']) {
    expect(replace(before, 'x', replacement)).toEqual({ reason: 'invalid-input' });
  }
  expect(replace(before, 'x', 'N')).toEqual({ reason: 'changed-syntax' });
  expect(replace(makeDocument('x', '{x\\b1}'), 'x', '')).toEqual({ reason: 'changed-syntax' });
  expect(before.cues.map(cue => cue.text)).toEqual(['x', '\\x']);
});

it('rejects oversized candidates before expanding them in memory', () => {
  const before = makeDocument('aaa');
  expect(replace(before, 'a', '🙂'.repeat(8000))).toEqual({ reason: 'text-too-long' });
  expect(replace(makeDocument(...Array<string>(40).fill('a')), 'a', '🙂'.repeat(8000))).toEqual({ reason: 'document-too-large' });
});
