import type { AssDocument } from '../contracts/subtitles';
import type { ProjectStyle, ScriptSettings, StyleField, StyleFields } from '../contracts/styles';

export const fieldLabels: Record<StyleField, string> = {
  Fontname: '字体名称', Fontsize: '字号', PrimaryColour: '主颜色', SecondaryColour: '次颜色', OutlineColour: '描边颜色', BackColour: '阴影颜色',
  Bold: '粗体', Italic: '斜体', Underline: '下划线', StrikeOut: '删除线', ScaleX: '水平缩放 (%)', ScaleY: '垂直缩放 (%)',
  Spacing: '字距', Angle: '角度', BorderStyle: '边框类型', Outline: '描边', Shadow: '阴影', Alignment: '对齐方式',
  MarginL: '左边距', MarginR: '右边距', MarginV: '垂直边距', Encoding: 'Encoding',
};
export const fieldGroups: { label: string; fields: StyleField[] }[] = [
  { label: '字体', fields: ['Fontname', 'Fontsize', 'Bold', 'Italic', 'Underline', 'StrikeOut'] },
  { label: '颜色与边框', fields: ['PrimaryColour', 'SecondaryColour', 'OutlineColour', 'BackColour', 'BorderStyle', 'Outline', 'Shadow'] },
  { label: '位置与其他属性', fields: ['Alignment', 'MarginL', 'MarginR', 'MarginV', 'ScaleX', 'ScaleY', 'Spacing', 'Angle', 'Encoding'] },
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
