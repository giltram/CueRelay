import limits from '../../../shared/glossary-limits.json';
import type { EntryValues } from '../contracts/glossary';
export { limits as glossaryLimits };
export function validateEntry(values: EntryValues): string {
  for (const [field, label] of [['original', '原词'], ['translation', '统一译名'], ['note', '备注']] as const) {
    const value = values[field].trim();
    if (field !== 'note' && !value) return `${label}不能为空。`;
    // Match Python's Unicode code point limits, including non-BMP characters.
    if ([...value].length > limits[field]) return `${label}最多 ${limits[field]} 个字符。`;
    if (/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return `${label}包含无效字符。`;
  }
  return '';
}
