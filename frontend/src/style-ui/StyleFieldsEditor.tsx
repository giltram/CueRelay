import { formatMessage, t } from '../i18n';
import { useLocale } from "../i18n/react";
import type { ScriptSettings, StyleField, StyleFields } from '../contracts/styles';
import { assColor, colors, fieldGroups, fieldLabels, flags, replaceRgb } from './style-fields';

export function StyleFieldsEditor({ value, onChange, selected, onToggle }: {
  value: StyleFields; onChange: (fields: StyleFields) => void;
  selected?: readonly StyleField[]; onToggle?: (field: StyleField) => void;
}) {
  useLocale();
  function input(field: StyleField) {
    const disabled = selected !== undefined && !selected.includes(field);
    const set = (text: string) => onChange({ ...value, [field]: text });
    const label = formatMessage(fieldLabels[field]);
    if (flags.includes(field)) return <select aria-label={label} disabled={disabled} value={value[field]} onChange={event => set(event.target.value)}>
      <option value="0">{t("styleUi.no")}</option><option value="-1">{t("styleUi.yes")}</option>
    </select>;
    if (colors.includes(field)) return <div className="style-color-input">
      <input type="color" aria-label={`${label} RGB`} disabled={disabled} value={assColor(value[field])?.rgb ?? '#000000'} onChange={event => set(replaceRgb(value[field], event.target.value))} />
      <input aria-label={label} disabled={disabled} value={value[field]} maxLength={10} onChange={event => set(event.target.value)} />
    </div>;
    if (field === 'Alignment') return <select aria-label={label} disabled={disabled} value={value[field]} onChange={event => set(event.target.value)}>
      {[t("styleUi.bottomLeft"), t("styleUi.bottomCenter"), t("styleUi.bottomRight"), t("styleUi.middleLeft"), t("styleUi.middleCenter"), t("styleUi.middleRight"), t("styleUi.topLeft"), t("styleUi.topCenter"), t("styleUi.topRight")].map((text, index) => <option value={index + 1} key={index}>{index + 1} · {text}</option>)}
    </select>;
    if (field === 'BorderStyle') return <select aria-label={label} disabled={disabled} value={value[field]} onChange={event => set(event.target.value)}>
      <option value="1">{t("styleUi.outlineAndShadow")}</option><option value="3">{t("styleUi.opaqueBox")}</option>
    </select>;
    return <input aria-label={label} type={field === 'Fontname' ? 'text' : 'number'} step="any" disabled={disabled} value={value[field]} onChange={event => set(event.target.value)} />;
  }
  return <div className="style-fields">{fieldGroups.map(group => <fieldset key={group.fields[0]}>
    <legend>{formatMessage(group.label)}</legend><div className="style-field-grid">{group.fields.map(field => <div className="style-field" key={field}>
      {selected ? <label className="style-check"><input type="checkbox" checked={selected.includes(field)} aria-label={t("styleUi.batchChangeValue", { v0: formatMessage(fieldLabels[field]) })} onChange={() => onToggle?.(field)} />{formatMessage(fieldLabels[field])}</label>
        : <span>{formatMessage(fieldLabels[field])}</span>}
      {input(field)}
    </div>)}</div>
  </fieldset>)}<p className="hint">{t("styleUi.assColorsUseHaabbggrrAa00IsOpaque")}</p></div>;
}

export function ScriptSettingsEditor({ value, onChange, label = t("styleUi.assScriptResolution") }: { value: ScriptSettings; onChange: (value: ScriptSettings) => void; label?: string }) {
  useLocale();
  return <fieldset className="style-script"><legend>{label}</legend><div className="style-field-grid">
    {(['play_res_x', 'play_res_y'] as const).map((key, index) => <label key={key}>{index ? 'PlayResY' : 'PlayResX'}
      <input type="number" min={1} max={32768} step={1} aria-label={index ? 'PlayResY' : 'PlayResX'} value={value[key] ?? ''}
        onChange={event => onChange({ ...value, [key]: event.target.value === '' ? null : Number(event.target.value) })} />
    </label>)}
    <label>{t("styleUi.scaleBorderAndShadowWithScript")}<select aria-label="ScaledBorderAndShadow" value={value.scaled_border_and_shadow === null ? '' : String(value.scaled_border_and_shadow)}
      onChange={event => onChange({ ...value, scaled_border_and_shadow: event.target.value === '' ? null : event.target.value === 'true' })}>
      <option value="">{t("styleUi.unspecified")}</option><option value="true">{t("styleUi.yes")}</option><option value="false">{t("styleUi.no")}</option>
    </select></label>
  </div><p className="hint">{t("styleUi.thisIsTheAssCoordinateSpaceIndependentOf")}</p></fieldset>;
}
