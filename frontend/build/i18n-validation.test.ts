import { expect, it } from 'vitest';
import { flattenCatalog, validateCatalogs } from './i18n-validation';

it('validates semantic families rather than requiring identical raw plural keys', () => {
  const catalogs = { en: { lines_one: '{{count}} line', lines_other: '{{count}} lines' },
    'zh-CN': { lines_other: '{{count}} 行' }, ar: {
      lines_zero: '{{count}} lines', lines_one: 'one line', lines_two: 'two lines', lines_few: '{{count}} lines', lines_many: '{{count}} lines', lines_other: '{{count}} lines' } };
  expect(validateCatalogs(catalogs, 'en')).toEqual([]);
  expect(validateCatalogs({ ...catalogs, ar: { lines_other: '{{count}} lines' } }, 'en')).toContain('ar: missing plural lines_few');
});
it('rejects missing messages, empty translations and renamed interpolation parameters', () => {
  expect(validateCatalogs({ en: { save: '{{name}} saved' }, 'zh-CN': { save: '{{project}} 已保存' } }, 'en')[0]).toMatch(/placeholder mismatch/);
  expect(validateCatalogs({ en: { save: 'Saved' }, 'zh-CN': {} }, 'en')[0]).toMatch(/semantic key save/);
  expect(() => flattenCatalog({ save: '' })).toThrow(/Empty translation/);
});
