import { useMessageState, useLocale } from '../i18n/react';
import { msg, t } from "../i18n";
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { useEffect, useMemo, useState } from 'react';
import type { AssDocument, Cue, StyleResult } from '../contracts/subtitles';
import type { JsonRequest } from '../contracts/http';
import type { ImportStyle, ProjectStyle, StyleField, StyleFields, StyleOperation, StyleUsage } from '../contracts/styles';
import { Modal } from '../page-ui/Modal';
import { StyleSamplePreview } from '../ass-preview/StyleSamplePreview';
import { localStyleOperation, templateApi } from '../project-data/styles-api';
import { StyleFieldsEditor, ScriptSettingsEditor } from './StyleFieldsEditor';
import { TemplateImportSelection } from './TemplateImportSelection';
import { assColor, chosenFields, sampleStyleDocument, uniqueStyleName } from './style-fields';

type Mode = 'edit' | 'create' | 'copy' | 'batch' | 'script' | 'import' | 'assign';

export function ProjectStyleManager({ document, cueRows, selectedCueId, editable, canEditSubtitles = editable, persisted, request, organizationId, canCreateTemplate, projectName,
  onApply, onClose }: {
  document: AssDocument; cueRows: readonly Cue[]; selectedCueId: string | null; editable: boolean; canEditSubtitles?: boolean; persisted: boolean;
  request?: JsonRequest; organizationId?: number; canCreateTemplate?: boolean; projectName?: string;
  onApply: (operation: StyleOperation) => Promise<StyleResult>; onClose: () => void;
}) {
  useLocale();
  const [activeId, setActiveId] = useState(document.cues.find(c => c.id === selectedCueId)?.style_id ?? document.styles[0].id);
  const active = document.styles.find(style => style.id === activeId) ?? document.styles[0];
  const [name, setName] = useState(active.name);
  const [fields, setFields] = useState<StyleFields>(active.fields);
  const [mode, setMode] = useState<Mode>('edit');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [batchFields, setBatchFields] = useState<StyleField[]>([]);
  const [script, setScript] = useState(document.script);
  const [imports, setImports] = useState<ImportStyle[]>([]);
  const [cueIds, setCueIds] = useState<string[]>(selectedCueId ? [selectedCueId] : []);
  const [usage, setUsage] = useState<StyleUsage>({});
  const [error, setError] = useMessageState('');
  const [message, setMessage] = useMessageState('');
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [usageError, setUsageError] = useMessageState('');
  const sampleFields = mode === 'batch' ? { ...active.fields, ...chosenFields(fields, batchFields) } : fields;
  const sample = useMemo(() => sampleStyleDocument(document, active, sampleFields, mode === 'script' ? script : document.script), [document, active, fields, batchFields, mode, script]);
  useEffect(() => {
    let current = true;
    void localStyleOperation(document, { type: 'inspect' }).then(result => { if (current) { setUsage(result.usage); setUsageError(''); } })
      .catch(reason => { if (current) setUsageError(reason); });
    return () => { current = false; };
  }, [document]);
  function choose(style: ProjectStyle) {
    setActiveId(style.id); setName(style.name); setFields(style.fields); setMode('edit'); setConfirmDelete(false); setError(''); setMessage('');
  }
  async function perform(operation: StyleOperation) {
    if (pending || (operation.type === 'assign' ? !canEditSubtitles : !editable)) return;
    const origin = captureDiagnosticOrigin();
    setPending(true); setError(''); setMessage(''); setConfirmDelete(false);
    try {
      const result = await onApply(operation);
      setUsage(result.usage); setSelected([]);
      const next = operation.type === 'create' || operation.type === 'copy' || operation.type === 'import' || operation.type === 'import_many' ? result.document.styles.at(-1)!
        : result.document.styles.find(s => s.id === active.id) ?? result.document.styles[0];
      if (operation.type === 'import_many' || operation.type === 'import') setImports([]);
      choose(next);
      setMessage(persisted ? msg("styleUi.projectStylesSaved") : msg("styleUi.stylesAppliedToTheLocalDocumentExportSoon"));
    } catch (reason) { reportFailure('style-ui', 'handled_error', reason, origin); setError(reason as Error); }
    finally { setPending(false); }
  }
  const applyLabel = persisted ? t("styleUi.applyAndSave") : t("styleUi.applyToLocalDocument");
  const disabled = pending || !editable;
  return <Modal title={persisted ? t("styleUi.stylesManager") : t("styleUi.localStylesManager")} onClose={pending ? undefined : onClose}>
    <div className="style-manager">
      {(!persisted || !editable) && <p className="hint">{!persisted && t("styleUi.localStylesStayOnThisPageExportAss")}{!editable && t("styleUi.readOnly")}</p>}
      <div className="style-manager-layout">
        <section className="style-list" aria-label={t("styleUi.styles")}>
          <label>{t("styleUi.searchStyles")}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <p className="hint">{t("styleUi.selectionSummary", { selected: selected.length, total: document.styles.length })}</p>
          <div className="style-list-rows">{document.styles.filter(style => style.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(style => <div key={style.id} className="style-list-row" data-active={style.id === active.id || undefined}>
            <input type="checkbox" aria-label={t("styleUi.selectStyleValue", { v0: style.name })} disabled={pending} checked={selected.includes(style.id)}
              onChange={event => { setConfirmDelete(false); setSelected(event.target.checked ? [...selected, style.id] : selected.filter(id => id !== style.id)); }} />
            <button type="button" disabled={pending} onClick={() => { choose(style); if (mode === 'assign') setMode('assign'); }}>
              <span className="style-swatch" style={{ backgroundColor: assColor(style.fields.PrimaryColour)?.rgb }} aria-hidden="true" />
              <span>{style.name}<small>{t("styleUi.cueUsage", { count: document.cues.filter(c => c.style_id === style.id).length })}{usage[style.id]?.comments ? t("styleUi.commentUsage", { count: usage[style.id].comments }) : ''}</small></span>
            </button>
          </div>)}</div>
          {usageError && <p role="alert" className="hint">{t("styleUi.usageFailure", { reason: usageError })}</p>}
          <div className="controls">
            <button disabled={disabled} onClick={() => { setMode('create'); setName(uniqueStyleName(t("styleUi.newStyle"), document.styles)); setFields(active.fields); setConfirmDelete(false); }}>{t("styleUi.new")}</button>
            <button disabled={disabled} onClick={() => { setMode('copy'); setName(uniqueStyleName(active.name, document.styles)); setFields(active.fields); setConfirmDelete(false); }}>{t("styleUi.copyCurrentStyle")}</button>
            <button disabled={disabled || !selected.length} onClick={() => { setMode('batch'); setFields(active.fields); setBatchFields([]); setConfirmDelete(false); }}>{t("styleUi.batchEdit")}</button>
            <button disabled={disabled || !selected.length || selected.some(id => (usage[id]?.cues ?? 0) + (usage[id]?.comments ?? 0) > 0)} onClick={() => setConfirmDelete(true)}>{t("styleUi.deleteSelected")}</button>
          </div>
          {confirmDelete && <div className="confirm"><p>{t(persisted ? "styleUi.deletePersisted" : "styleUi.deleteLocal", { count: selected.length })}</p><div className="controls">
            <button disabled={disabled} onClick={() => void perform({ type: 'delete', ids: selected })}>{t("styleUi.confirmStyleDeletion")}</button>
            <button disabled={pending} onClick={() => setConfirmDelete(false)}>{t("styleUi.cancelDeletion")}</button>
          </div></div>}
        </section>
        <section className="style-detail" aria-label={t("styleUi.styleProperties")}>
          <div className="controls">
            <button disabled={pending} aria-pressed={mode === 'edit'} onClick={() => choose(active)}>{t("styleUi.currentStyle")}</button>
            <button disabled={pending} aria-pressed={mode === 'script'} onClick={() => { setMode('script'); setScript(document.script); }}>{t("styleUi.scriptProperties")}</button>
            <button disabled={pending || !persisted || !request || !organizationId} aria-pressed={mode === 'import'} onClick={() => setMode('import')}>{t("styleUi.importFromOrganization")}</button>
            <button disabled={pending} aria-pressed={mode === 'assign'} onClick={() => setMode('assign')}>{t("styleUi.assignStyleToSubtitles")}</button>
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          {message && <p role="status">{message}</p>}
          {mode !== 'import' && <StyleSamplePreview document={sample} />}
          <fieldset disabled={pending || (mode === 'assign' ? !canEditSubtitles : !editable)}>
            {mode === 'import' && request && organizationId ? <>
              <TemplateImportSelection request={request} organizationId={organizationId} value={imports} onChange={setImports} existing={document.styles} />
              <p className="hint">{t("styleUi.importSummary", { count: imports.length })}</p>
              <button className="primary" disabled={!imports.length} onClick={() => void perform({ type: 'import_many', imports })}>{applyLabel}</button>
            </> : mode === 'script' ? <>
              <ScriptSettingsEditor value={script} onChange={setScript} />
              <button className="primary" onClick={() => void perform({ type: 'script', script })}>{applyLabel}</button>
            </> : mode === 'assign' ? <>
              <p>{t("styleUi.assignDescription", { name: active.name })}</p>
              <div className="controls"><button type="button" onClick={() => setCueIds(document.cues.map(c => c.id))}>{t("styleUi.selectAllSubtitles")}</button>
                <button type="button" onClick={() => setCueIds([])}>{t("styleUi.clearSubtitleSelection")}</button></div>
              <div className="style-cue-list">{cueRows.map((cue, index) => <label key={cue.id} className="style-check">
                <input type="checkbox" aria-label={t("styleUi.assignLineValue", { v0: index + 1 })} checked={cueIds.includes(cue.id)} onChange={event => setCueIds(event.target.checked ? [...cueIds, cue.id] : cueIds.filter(id => id !== cue.id))} />
                {index + 1}. {cue.text.slice(0, 60) || t("styleUi.emptyLine")}
              </label>)}</div>
              <button className="primary" disabled={!cueIds.length} onClick={() => void perform({ type: 'assign', cue_ids: cueIds, style_id: active.id })}>{t("styleUi.applySelected", { action: applyLabel, count: cueIds.length })}</button>
            </> : <>
              {mode === 'batch' ? <p>{t("styleUi.batchDescription", { count: selected.length })}</p>
                : <label>{t("styleUi.styleName")}<input aria-label={t("styleUi.styleName")} value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>}
              {mode === 'edit' && active.origin && <p className="hint">{t("styleUi.sourceSnapshotDescription", { id: active.origin.template_id, revision: active.origin.revision })}</p>}
              <StyleFieldsEditor value={fields} onChange={setFields} selected={mode === 'batch' ? batchFields : undefined}
                onToggle={field => setBatchFields(batchFields.includes(field) ? batchFields.filter(item => item !== field) : [...batchFields, field])} />
              <div className="controls"><button className="primary" disabled={mode === 'batch' && (!selected.length || !batchFields.length)} onClick={() => void perform(mode === 'batch'
                ? { type: 'batch', ids: selected, fields: chosenFields(fields, batchFields) }
                : mode === 'create' ? { type: 'create', name, fields } : { type: mode === 'copy' ? 'copy' : 'update', id: active.id, name, fields })}>{applyLabel}</button>
              </div>
            </>}
          </fieldset>
          {request && organizationId && canCreateTemplate && ['edit', 'create', 'copy'].includes(mode) && <button disabled={pending} onClick={() => {
            const origin = captureDiagnosticOrigin();
            setPending(true); setError('');
            void templateApi(request, organizationId).create({ name, fields, reference: document.script, source_label: projectName ? `${projectName} / ${active.name}`.slice(0, 500) : t("styleUi.localWorkspace") })
              .then(() => setMessage(msg("styleUi.organizationTemplateSavedProjectStylesRemainIndependent"))).catch(reason => { reportFailure('style-ui', 'handled_error', reason, origin); setError(reason); }).finally(() => setPending(false));
          }}>{t("styleUi.saveAsOrganizationTemplate")}</button>}
        </section>
      </div>
    </div>
  </Modal>;
}
