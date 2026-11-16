import { useMessageState, useLocale } from '../i18n/react';
import { t } from "../i18n";
import { useEffect, useMemo, useState } from 'react';
import type { JsonRequest } from '../contracts/http';
import type { ImportStyle, StyleTemplate } from '../contracts/styles';
import { templateApi } from '../project-data/styles-api';
import { uniqueStyleName } from './style-fields';

/** Selected revisions are frozen; refreshing explicitly clears selections. */
export function TemplateImportSelection({ request, organizationId, value, onChange, existing = [] }: {
  request: JsonRequest; organizationId: number; value: ImportStyle[]; onChange: (value: ImportStyle[]) => void; existing?: readonly { name: string }[];
}) {
  useLocale();
  const api = useMemo(() => templateApi(request, organizationId), [request, organizationId]);
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useMessageState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void api.list().then(items => { if (active) setTemplates(items); }).catch(reason => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, version]);
  const update = (id: string, patch: Partial<ImportStyle>) => onChange(value.map(item => item.template_id === id ? { ...item, ...patch } : item));
  return <section className="style-import" aria-label={t("styleUi.importOrganizationTemplates")}>
    <div className="controls"><label>{t("styleUi.searchTemplates")}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button type="button" onClick={() => { onChange([]); setVersion(v => v + 1); }}>{t("styleUi.reloadTemplates")}</button></div>
    {loading && <p role="status">{t("styleUi.loadingTemplates")}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="style-template-list">{templates.filter(item => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(template => {
      const selected = value.find(item => item.template_id === template.id);
      return <div className="style-template-option" key={template.id}>
        <label className="style-check"><input type="checkbox" checked={Boolean(selected)} onChange={event => onChange(event.target.checked
          ? [...value, { type: 'import', template_id: template.id, revision: template.revision,
            name: uniqueStyleName(template.name, [...existing, ...value]), mode: 'copy' }]
          : value.filter(item => item.template_id !== template.id))} />{template.name}</label>
        <span className="hint">{template.fields.Fontname} · {template.fields.Fontsize} · {template.reference.play_res_x}×{template.reference.play_res_y} · v{template.revision}</span>
        {selected && <div className="style-field-grid">
          <label>{t("styleUi.importedName")}<input aria-label={t("styleUi.importedNameValue", { v0: template.name })} value={selected.name} maxLength={100} onChange={event => update(template.id, { name: event.target.value })} /></label>
          <label>{t("styleUi.adaptation")}<select aria-label={t("styleUi.adaptationValue", { v0: template.name })} value={selected.mode} onChange={event => update(template.id, { mode: event.target.value as 'copy' | 'scale' })}>
            <option value="copy">{t("styleUi.copyUnchanged")}</option><option value="scale">{t("styleUi.scaleProportionallyToPlayres")}</option>
          </select></label>
        </div>}
      </div>;
    })}</div>
    {!loading && !error && templates.length === 0 && <p className="hint">{t("styleUi.noOrganizationTemplatesCreateOneInOrganizationSettings")}</p>}
    <p className="hint">{t("styleUi.importCreatesAnIndependentSnapshotLaterTemplateChanges")}</p>
  </section>;
}
