import { afterEach, expect, it } from 'vitest';
import { i18n, formatMessage, msg } from './index';
import { resolveLanguage } from './registry';
import { pseudoResource, pseudolocalize } from './pseudo';
import { MessageError, describe, messageFromWire } from '../contracts/messages';
import { checkSubtitles } from '../subtitle-qc/check-subtitles';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';

afterEach(() => i18n.changeLanguage('zh-CN'));
it('negotiates explicit, browser and Chinese fallback in that order', () => {
  expect(resolveLanguage('en', ['zh-CN'])).toBe('en');
  expect(resolveLanguage('system', ['fr', 'en-GB', 'zh-CN'])).toBe('en');
  expect(resolveLanguage('system', ['zh-TW', 'en'])).toBe('zh-CN');
  expect(resolveLanguage('system', ['fr'])).toBe('zh-CN');
});
it('reformats retained notifications, nested errors and QC without rerunning an operation', async () => {
  const error = new MessageError(describe('server.styleNumberValueMustBeFiniteAndHaveAn', '旧原因', { v0: 'Fontsize' }));
  const notification = msg('common.languageFailure', { reason: error });
  const chinese = formatMessage(notification);
  await i18n.changeLanguage('en');
  expect(formatMessage(notification)).toContain('Fontsize');
  expect(formatMessage(notification)).not.toBe(chinese);
  const document = { schema_version: 2 as const, source: '', script: testScript, styles: [testStyle('Default')], cues: [{ id: 'new-one', style_id: 'Default', start_ms: 0, end_ms: 2000, text: '' }] };
  const report = checkSubtitles(document);
  const issue = report.find(issue => issue.type === 'empty-text')!;
  const english = formatMessage(issue.message);
  await i18n.changeLanguage('zh-CN');
  expect(formatMessage(issue.message)).not.toBe(english);
  expect(report.find(item => item.id === issue.id)).toBe(issue);
});
it('preserves structured specific remote reasons and exact unknown legacy details', async () => {
  const error = messageFromWire({ message: '旧密码不正确。', reason: 'server.theCurrentPasswordIsIncorrect' });
  await i18n.changeLanguage('en');
  expect(formatMessage(error)).toBe('The current password is incorrect.');
  expect(formatMessage(messageFromWire({ message: 'Specific old-server detail' }))).toBe('Specific old-server detail');
});
it('expands English prose while preserving interpolation, identifiers and plural families', () => {
  const source = 'Save project and check subtitle timing';
  expect(pseudolocalize(source).length).toBeGreaterThanOrEqual(source.length * 1.5);
  const pseudo = pseudoResource({ lines_one: '{{count}} line in PlayResX', lines_other: '{{count}} lines in PlayResX' });
  expect(Object.keys(pseudo)).toEqual(['lines_one', 'lines_other']);
  expect(pseudo.lines_one).toContain('{{count}}');
  expect(pseudo.lines_one).toContain('PlayResX');
  expect(pseudolocalize('Ctrl+Shift+Z ASS 10ms \\N')).toContain('Ctrl+Shift+Z ASS 10ms \\N');
});
