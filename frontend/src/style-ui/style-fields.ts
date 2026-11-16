import { type MessageValue, describe } from '../contracts/messages';
import type { AssDocument } from '../contracts/subtitles';
import type { ProjectStyle, ScriptSettings, StyleField, StyleFields } from '../contracts/styles';

export const fieldLabels: Record<StyleField, MessageValue> = {
  Fontname: describe("styleUi.fontName", "字体名称"), Fontsize: describe("styleUi.fontSize", "字号"), PrimaryColour: describe("styleUi.primaryColor", "主颜色"), SecondaryColour: describe("styleUi.secondaryColor", "次颜色"), OutlineColour: describe("styleUi.outlineColor", "描边颜色"), BackColour: describe("styleUi.shadowColor", "阴影颜色"),
  Bold: describe("styleUi.bold", "粗体"), Italic: describe("styleUi.italic", "斜体"), Underline: describe("styleUi.underline", "下划线"), StrikeOut: describe("styleUi.strikeout", "删除线"), ScaleX: describe("styleUi.horizontalScale", "水平缩放 (%)"), ScaleY: describe("styleUi.verticalScale", "垂直缩放 (%)"),
  Spacing: describe("styleUi.spacing", "字距"), Angle: describe("styleUi.rotation", "角度"), BorderStyle: describe("styleUi.borderStyle", "边框类型"), Outline: describe("styleUi.outline", "描边"), Shadow: describe("styleUi.shadow", "阴影"), Alignment: describe("styleUi.alignment", "对齐方式"),
  MarginL: describe("styleUi.leftMargin", "左边距"), MarginR: describe("styleUi.rightMargin", "右边距"), MarginV: describe("styleUi.verticalMargin", "垂直边距"), Encoding: describe('styleUi.encoding', 'Encoding'),
};
export const fieldGroups: { label: MessageValue; fields: StyleField[] }[] = [
  { label: describe("styleUi.font", "字体"), fields: ['Fontname', 'Fontsize', 'Bold', 'Italic', 'Underline', 'StrikeOut'] },
  { label: describe("styleUi.colorsAndBorders", "颜色与边框"), fields: ['PrimaryColour', 'SecondaryColour', 'OutlineColour', 'BackColour', 'BorderStyle', 'Outline', 'Shadow'] },
  { label: describe("styleUi.positionAndOtherProperties", "位置与其他属性"), fields: ['Alignment', 'MarginL', 'MarginR', 'MarginV', 'ScaleX', 'ScaleY', 'Spacing', 'Angle', 'Encoding'] },
];
export const flags: StyleField[] = ['Bold', 'Italic', 'Underline', 'StrikeOut'];
export const colors: StyleField[] = ['PrimaryColour', 'SecondaryColour', 'OutlineColour', 'BackColour'];

export function assColor(value: string) {
  const match = /^&H([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  return match ? { rgb: `#${match[4]}${match[3]}${match[2]}`, alpha: parseInt(match[1], 16) } : null;
}
export function replaceRgb(value: string, rgb: string) {
  const alpha = assColor(value)?.alpha ?? 0;
  return `&H${alpha.toString(16).padStart(2, '0')}${rgb.slice(5, 7)}${rgb.slice(3, 5)}${rgb.slice(1, 3)}`.toUpperCase();
}
export function chosenFields(fields: StyleFields, selected: readonly StyleField[]): Partial<StyleFields> {
  return Object.fromEntries(selected.map(key => [key, fields[key]]));
}
export function uniqueStyleName(name: string, styles: readonly { name: string }[]) {
  if (!styles.some(style => style.name === name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, 90)} (${n})`;
    if (!styles.some(style => style.name === candidate)) return candidate;
  }
}
/** Disposable preview: one full-duration sample, no changes to editor content or saved state. */
export function sampleStyleDocument(document: AssDocument, style: ProjectStyle, fields: StyleFields, script: ScriptSettings = document.script): AssDocument {
  return { ...document, script, styles: document.styles.map(item => item.id === style.id ? { ...item, fields } : item),
    cues: [{ id: 'new-style-preview', start_ms: 0, end_ms: 35999990, text: '字幕样式预览 / Sample 123', style_id: style.id }] };
}
