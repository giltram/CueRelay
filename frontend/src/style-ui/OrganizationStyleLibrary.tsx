import { useMessageState, useLocale } from '../i18n/react';
import { t } from "../i18n";
import { HeaderNotice } from '../page-ui/PageLayout';
import { useEffect, useMemo, useState } from 'react';
import type { AssDocument } from '../contracts/subtitles';
import type { JsonRequest } from '../contracts/http';
import type { StyleTemplate, TemplateInput } from '../contracts/styles';
import { importAss, loadEmptyDocument } from '../project-data/ass-api';
import { templateApi } from '../project-data/styles-api';
import { Modal } from '../page-ui/Modal';
import { StyleSamplePreview } from '../ass-preview/StyleSamplePreview';
import { ScriptSettingsEditor, StyleFieldsEditor } from './StyleFieldsEditor';
import { sampleStyleDocument } from './style-fields';

export function OrganizationStyleLibrary({ request, organizationId, canCreate, canEdit, canDelete, enabled }: {
  request: JsonRequest; organizationId: number; canCreate: boolean; canEdit: boolean; canDelete: boolean; enabled: boolean;
}) {
  useLocale();
  const api = useMemo(() => templateApi(request, organizationId), [request, organizationId]);
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const [base, setBase] = useState<AssDocument | null>(null);
  const [imported, setImported] = useState<AssDocument | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [editor, setEditor] = useState<{ template?: StyleTemplate; input: TemplateInput } | null>(null);
  const [deleting, setDeleting] = useState<StyleTemplate | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true); setError('');
    void Promise.all([api.list(), loadEmptyDocument()]).then(([items, document]) => { if (active) { setTemplates(items); setBase(document); } })
      .catch(reason => { if (active) setError(reason); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refresh, enabled]);
  const editorEditable = editor?.template ? canEdit : canCreate;
  const patch = (value: Partial<TemplateInput>) => setEditor(current => current ? { ...current, input: { ...current.input, ...value } } : current);
  return <section className="organization-style-library" aria-label={t("styleUi.organizationStyleLibrary")}>
    <h2>{t("styleUi.organizationStyleLibrary")}</h2>
    <p className="hint">{t("styleUi.projectsCopyTemplatesEditingOrDeletingATemplate")}{!(canCreate || canEdit || canDelete) && t("styleUi.managedBy")}</p>
    <div className="controls style-library-toolbar"><label>{t("styleUi.searchOrganizationStyles")}<input type="search" disabled={!enabled} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button disabled={!enabled || busy || loading} title={t("styleUi.getTemplatesUpdatedByOtherMembersOrTabs")} onClick={() => setRefresh(v => v + 1)}>{t("styleUi.refresh")}</button>
      {canCreate && <button disabled={!enabled || busy || !base} onClick={() => {
        setError(''); setEditor({ input: { name: '', fields: base!.styles[0].fields, reference: base!.script, source_label: '' } });
      }}>{t("styleUi.newTemplate")}</button>}
    </div>
    {canCreate && <label className="style-file-import file-picker">{t("styleUi.extractStyleTemplateFromAss")}<input aria-label={t("styleUi.extractStyleTemplateFromAss")} title={t("styleUi.extractStyleTemplateFromAss")} type="file" accept=".ass" disabled={!enabled || busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setBusy(true); setError('');
      void importAss(file).then(document => { setImported(document); setSourceLabel(file.name.slice(0, 500)); })
        .catch(reason => setError(reason)).finally(() => setBusy(false));
    }} /></label>}
    {loading && <HeaderNotice>{t("styleUi.loadingStyleLibrary")}</HeaderNotice>}
    {error && !editor && !deleting && <HeaderNotice className="header-error" role="alert">{error}</HeaderNotice>}
    {canCreate && imported && <div className="style-import-candidates"><p>{t("styleUi.importSourceDescription", { name: sourceLabel })}</p>
      <div className="controls">{imported.styles.map(style => <button key={style.id} disabled={busy || !enabled} onClick={() => {
        setEditor({ input: { name: style.name, fields: style.fields, reference: imported.script, source_label: sourceLabel } }); setError('');
      }}>{t("styleUi.importStyle", { name: style.name })}</button>)}<button onClick={() => setImported(null)}>{t("styleUi.finishExtraction")}</button></div>
    </div>}
    <div className="style-library-table"><table><thead><tr><th>{t("styleUi.template")}</th><th>{t("styleUi.referenceResolution")}</th><th>{t("styleUi.sourceUpdated")}</th><th>{t("styleUi.action")}</th></tr></thead>
      <tbody>{templates.filter(t => t.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(template => <tr key={template.id}>
        <td>{template.name}
          <p className="hint">{template.fields.Fontname} · {template.fields.Fontsize}</p></td>
        <td>{template.reference.play_res_x}×{template.reference.play_res_y}</td>
        <td>{template.source_label || t("styleUi.createdManually")}<p className="hint">{template.updated_by.username} · v{template.revision}</p></td>
        <td><div className="controls"><button disabled={busy || !enabled} onClick={() => { setError(''); setEditor({ template, input: { name: template.name, fields: template.fields, reference: template.reference, source_label: template.source_label } }); }}>{canEdit ? t("styleUi.edit") : t("styleUi.view")}</button>
          {canDelete && <button disabled={busy || !enabled} onClick={() => { setDeleting(template); setError(''); }}>{t("styleUi.delete")}</button>}</div></td>
      </tr>)}</tbody></table></div>
    {!loading && !templates.length && <p className="hint">{t("styleUi.noTemplatesYet")}</p>}
    {editor && base && <Modal title={editor.template ? t(editorEditable ? "styleUi.editTemplate" : "styleUi.viewTemplate") : t("styleUi.newOrganizationTemplate")} showCloseButton={false} onClose={busy ? undefined : () => setEditor(null)}>
      <form className="account-form" onSubmit={event => {
        event.preventDefault(); if (!editorEditable || !enabled) return;
        setBusy(true); setError('');
        void (editor.template ? api.update(editor.template, editor.input) : api.create(editor.input))
          .then(() => { setEditor(null); setRefresh(v => v + 1); }).catch(reason => setError(reason)).finally(() => setBusy(false));
      }}>
        <StyleSamplePreview document={sampleStyleDocument(base, base.styles[0], editor.input.fields, editor.input.reference)} />
        <fieldset disabled={busy || !editorEditable || !enabled} className="account-form">
          <label>{t("styleUi.templateName")}<input aria-label={t("styleUi.templateName")} required maxLength={100} value={editor.input.name} onChange={event => patch({ name: event.target.value })} /></label>
          <label>{t("styleUi.sourceDescription")}<input aria-label={t("styleUi.templateSourceDescription")} maxLength={500} value={editor.input.source_label} onChange={event => patch({ source_label: event.target.value })} /></label>
          <ScriptSettingsEditor value={editor.input.reference} label={t("styleUi.templateReferenceScriptResolution")} onChange={reference => patch({ reference })} />
          <StyleFieldsEditor value={editor.input.fields} onChange={fields => patch({ fields })} />
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="controls"><button type="button" disabled={busy} onClick={() => setEditor(null)}>{editorEditable ? t("styleUi.cancel") : t("styleUi.close")}</button>
          {editorEditable && <button className="primary" disabled={busy || !enabled}>{t("styleUi.saveTemplate")}</button>}</div>
      </form>
    </Modal>}
    {deleting && <Modal title={t("styleUi.deleteOrganizationTemplate")} onClose={busy ? undefined : () => setDeleting(null)}>
      <p>{t("styleUi.deleteTemplateConfirmation", { name: deleting.name })}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="controls"><button disabled={busy} onClick={() => setDeleting(null)}>{t("styleUi.cancel")}</button>
        <button disabled={busy || !enabled || !canDelete} onClick={() => {
          setBusy(true); setError('');
          void api.delete(deleting).then(() => { setDeleting(null); setRefresh(v => v + 1); }).catch(reason => setError(reason)).finally(() => setBusy(false));
        }}>{t("styleUi.confirmTemplateDeletion")}</button></div>
    </Modal>}
  </section>;
}
