import { type MessageValue, describe } from '../contracts/messages';
import limits from '../../../shared/glossary-limits.json';
import type { EntryValues } from '../contracts/glossary';
export { limits as glossaryLimits };
export function validateEntry(values: EntryValues): MessageValue {
  for (const [field, label] of [['original', describe("glossaryData.originalTerm", "原词")], ['translation', describe("glossaryData.preferredTranslation", "统一译名")], ['note', describe("glossaryData.note", "备注")]] as const) {
    const value = values[field].trim();
    if (field !== 'note' && !value) return describe("glossaryData.valueIsRequired", "{{v0}}不能为空。", { v0: label });
    // Match Python's Unicode code point limits, including non-BMP characters.
    if ([...value].length > limits[field]) return describe("glossaryData.valueMustBeAtMostValueCharacters", "{{v0}}最多 {{v1}} 个字符。", { v0: label, v1: limits[field] });
    if (/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return describe("glossaryData.valueContainsInvalidCharacters", "{{v0}}包含无效字符。", { v0: label });
  }
  return '';
}
