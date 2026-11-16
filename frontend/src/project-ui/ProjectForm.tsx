import { useMessageState, useLocale } from '../i18n/react';
import { t, msg } from "../i18n";
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { useEffect, useRef, useState } from 'react';
import type { Organization } from '../account-ui/api';
import { Modal } from '../page-ui/Modal';
import type { ProjectDetail, MediaManifest } from '../contracts/projects';
import { VideoFilePicker } from '../media/VideoFilePicker';
import type { SelectedVideo } from '../media/video-file-access';
import { createMediaManifest } from '../media/media-manifest';
import { importAss, loadEmptyDocument } from '../project-data/ass-api';
import type { JsonRequest } from '../contracts/http';
import type { ImportStyle, ScriptSettings } from '../contracts/styles';
import { TemplateImportSelection } from '../style-ui/TemplateImportSelection';
import { ScriptSettingsEditor } from '../style-ui/StyleFieldsEditor';
import type { projectApi } from '../project-data/projects-api';

export function ProjectForm({ organization, api, request, onClose, onSaved }: {
  organization: Organization; api: ReturnType<typeof projectApi>; request: JsonRequest;
  onClose: () => void; onSaved: (project: ProjectDetail, video?: SelectedVideo) => void;
}) {
  useLocale();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [media, setMedia] = useState<MediaManifest | null>(null);
  const selectedFile = useRef<SelectedVideo | undefined>(undefined);
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [assName, setAssName] = useState('');
  const [mode, setMode] = useState<'empty' | 'import'>('empty');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [script, setScript] = useState<ScriptSettings | null>(null);
  const [styleImports, setStyleImports] = useState<ImportStyle[]>([]);
  const [initialStyles, setInitialStyles] = useState<{ name: string }[]>([]);
  const initialDocumentVersion = useRef(0);
  useEffect(() => {
    let active = true;
    const version = initialDocumentVersion.current;
    void loadEmptyDocument().then(document => { if (active && version === initialDocumentVersion.current) { setScript(document.script); setInitialStyles(document.styles); } })
      .catch(reason => { if (active) setError(reason); });
    return () => { active = false; };
  }, []);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function inspect(selection: SelectedVideo) {
    const { file } = selection;
    const origin = captureDiagnosticOrigin();
    controller.current?.abort();
    const task = new AbortController(); controller.current = task;
    selectedFile.current = selection;
    setBusy(true); setError(''); setMedia(null); setProgress(0); setFileName(file.name);
    try {
      const value = await createMediaManifest(file, task.signal, setProgress);
      if (!task.signal.aborted) setMedia(value);
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin); if (!task.signal.aborted) setError(reason as Error); }
    finally { if (controller.current === task) setBusy(false); }
  }
  return <Modal title={t("projectUi.newProject")} onClose={busy ? undefined : onClose}>
    <form className="account-form" onSubmit={event => {
      const origin = captureDiagnosticOrigin();
      event.preventDefault(); setError('');
      if (!media || (mode === 'import' && source === null)) { setError(msg("projectUi.finishVideoVerificationAndSelectTheInitialSubtitles")); return; }
      setBusy(true);
      void api.create({ name, description, media, source: mode === 'empty' ? null : source, style_imports: styleImports, ...(script ? { script } : {}) })
        .then(value => onSaved(value, selectedFile.current)).catch(reason => { reportFailure('project-ui', 'handled_error', reason, origin); setError(reason); }).finally(() => setBusy(false));
    }}>
      <p>{t("projectUi.organizationLabel", { name: organization.name })}</p>
      <label>{t("projectUi.projectName")}<input disabled={busy} value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></label>
      <label>{t("projectUi.projectDescription")}<textarea aria-label={t("projectUi.projectDescription")} disabled={busy} value={description} maxLength={2000} rows={3} onChange={event => setDescription(event.target.value)} /></label>
      <p>{t("projectUi.eachProjectUsesOneFixedVideoAndOne")}</p>
      <div>{t("projectUi.referenceVideo")}<VideoFilePicker label={t("projectUi.referenceVideo")} disabled={busy} onSelect={value => void inspect(value)} onError={setError}>{t("projectUi.chooseReferenceVideo")}</VideoFilePicker></div>
      {fileName && <p>{fileName} · {media ? t("projectUi.fullVerificationPassed") : t("projectUi.verificationProgressValue", { v0: Math.round(progress * 100) })}</p>}
      {busy && controller.current && !media && <button type="button" onClick={() => { controller.current?.abort(); setBusy(false); setFileName(''); }}>{t("projectUi.cancelVerification")}</button>}
      <label>{t("projectUi.initialSubtitles")}<select aria-label={t("projectUi.initialSubtitles")} disabled={busy} value={mode} onChange={event => setMode(event.target.value as 'empty' | 'import')}>
        <option value="empty">{t("projectUi.emptySubtitles")}</option><option value="import">{t("projectUi.importAss")}</option>
      </select></label>
      {mode === 'import' && <label className="file-picker">{t("projectUi.assFile")}<input aria-label={t("projectUi.assFile")} title={t("projectUi.assFile")} type="file" accept=".ass" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]; if (!file) return;
        initialDocumentVersion.current++;
        const origin = captureDiagnosticOrigin();
        setBusy(true); setError(''); setSource(null); setAssName('');
        void importAss(file).then(document => { setSource(document.source); setAssName(file.name); setScript(document.script); setInitialStyles(document.styles); })
          .catch(reason => { reportFailure('project-ui', 'handled_error', reason, origin); setError(reason); }).finally(() => setBusy(false));
        event.target.value = '';
      }} /></label>}
      {mode === 'import' && assName && <p>{t("projectUi.subtitleValidated", { name: assName })}</p>}
      <fieldset disabled={busy}>
        <details><summary>{t("projectUi.styleTemplatesAndScriptSettingsOptional")}</summary>
          {script && <ScriptSettingsEditor value={script} onChange={value => { initialDocumentVersion.current++; setScript(value); }} />}
          <TemplateImportSelection request={request} organizationId={organization.id} value={styleImports} onChange={setStyleImports} existing={initialStyles} />
        </details>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="controls">
        <button type="button" disabled={busy} onClick={onClose}>{t("projectUi.cancel")}</button>
        <button className="primary" disabled={busy || !media || (mode === 'import' && source === null)}>
          {busy ? t("projectUi.processing") : t("projectUi.createAndOpen")}
        </button>
      </div>
    </form>
  </Modal>;
}
