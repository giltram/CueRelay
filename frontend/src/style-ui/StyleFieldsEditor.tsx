import type { ScriptSettings, StyleField, StyleFields } from '../contracts/styles';
import { assColor, colors, fieldGroups, fieldLabels, flags, replaceRgb } from './style-fields';

export function StyleFieldsEditor({ value, onChange, selected, onToggle }: {
  value: StyleFields; onChange: (fields: StyleFields) => void;
  selected?: readonly StyleField[]; onToggle?: (field: StyleField) => void;
}) {
  function input(field: StyleField) {
    const disabled = selected !== undefined && !selected.includes(field);
    const set = (text: string) => onChange({ ...value, [field]: text });
    const label = fieldLabels[field];
    if (flags.includes(field)) return <select aria-label={label} disabled={disabled} value={value[field]} onChange={event => set(event.target.value)}>
      <option value="0">否</option><option value="-1">是</option>
    </select>;
    if (colors.includes(field)) return <div className="style-color-input">
      <input type="color" aria-label={`${label} RGB`} disabled={disabled} value={assColor(value[field])?.rgb ?? '#000000'} onChange={event => set(replaceRgb(value[field], event.target.value))} />
      <input aria-label={label} disabled={disabled} value={value[field]} maxLength={10} onChange={event => set(event.target.value)} />
    </div>;
    if (field === 'Alignment') return <select aria-label={label} disabled={disabled} value={value[field]} onChange={event => set(event.target.value)}>
      {['左下', '下中', '右下', '左中', '居中', '右中', '左上', '上中', '右上'].map((text, index) => <option value={index + 1} key={index}>{index + 1} · {text}</option>)}
    </select>;
    if (field === 'BorderStyle') return <select aria-label={label} disabled={disabled} value={value[field]} onChange={event => set(event.target.value)}>
      <option value="1">描边与阴影</option><option value="3">不透明框</option>
    </select>;
    return <input aria-label={label} type={field === 'Fontname' ? 'text' : 'number'} step="any" disabled={disabled} value={value[field]} onChange={event => set(event.target.value)} />;
  }
  return <div className="style-fields">{fieldGroups.map(group => <fieldset key={group.label}>
    <legend>{group.label}</legend><div className="style-field-grid">{group.fields.map(field => <div className="style-field" key={field}>
      {selected ? <label className="style-check"><input type="checkbox" checked={selected.includes(field)} aria-label={`批量修改${fieldLabels[field]}`} onChange={() => onToggle?.(field)} />{fieldLabels[field]}</label>
        : <span>{fieldLabels[field]}</span>}
      {input(field)}
    </div>)}</div>
  </fieldset>)}<p className="hint">ASS 颜色为 &amp;HAABBGGRR，AA=00 不透明、FF 透明。字体名称不保证本机可用；预览使用内置 Noto Sans SC 替代。</p></div>;
}

export function ScriptSettingsEditor({ value, onChange, label = 'ASS 脚本分辨率' }: { value: ScriptSettings; onChange: (value: ScriptSettings) => void; label?: string }) {
  return <fieldset className="style-script"><legend>{label}</legend><div className="style-field-grid">
    {(['play_res_x', 'play_res_y'] as const).map((key, index) => <label key={key}>{index ? 'PlayResY' : 'PlayResX'}
      <input type="number" min={1} max={32768} step={1} aria-label={index ? 'PlayResY' : 'PlayResX'} value={value[key] ?? ''}
        onChange={event => onChange({ ...value, [key]: event.target.value === '' ? null : Number(event.target.value) })} />
    </label>)}
    <label>描边和阴影随脚本缩放<select aria-label="ScaledBorderAndShadow" value={value.scaled_border_and_shadow === null ? '' : String(value.scaled_border_and_shadow)}
      onChange={event => onChange({ ...value, scaled_border_and_shadow: event.target.value === '' ? null : event.target.value === 'true' })}>
      <option value="">未指定</option><option value="true">yes</option><option value="false">no</option>
    </select></label>
  </div><p className="hint">这是 ASS 坐标空间，与视频像素分辨率独立。修改脚本设置不会自动缩放现有样式或字幕行的边距覆写。</p></fieldset>;
}
