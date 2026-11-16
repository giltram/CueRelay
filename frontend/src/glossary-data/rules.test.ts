import { legacyMessage } from '../contracts/messages';
import { expect, it } from 'vitest';
import { validateEntry } from './rules';
const values = { original: 'Alice', translation: '爱丽丝', note: '' };
it('validates required trimmed text, shared Unicode length limits and ordinary text', () => {
  expect(validateEntry(values)).toBe('');
  expect(legacyMessage(validateEntry({ ...values, original: ' \t\n ' }))).toContain('不能为空');
  expect(legacyMessage(validateEntry({ ...values, translation: ' ' }))).toContain('不能为空');
  expect(validateEntry({ ...values, original: '😀'.repeat(200) })).toBe('');
  expect(legacyMessage(validateEntry({ ...values, original: '😀'.repeat(201) }))).toContain('200');
  expect(legacyMessage(validateEntry({ ...values, note: '中'.repeat(2001) }))).toContain('2000');
  expect(validateEntry({ ...values, note: '<b>{\\b1} literal %_[]' })).toBe('');
  expect(legacyMessage(validateEntry({ ...values, note: '\0' }))).toContain('无效');
  expect(legacyMessage(validateEntry({ ...values, original: '\ud800' }))).toContain('无效');
});
