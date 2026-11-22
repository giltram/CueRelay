import { ReferenceFileField } from './ReferenceFileField';
import { useMessageState, useLocale } from '../i18n/react';
import { t, msg } from "../i18n";
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { useEffect, useRef, useState } from 'react';
import type { Organization } from '../account-ui/api';
import { Modal } from '../page-ui/Modal';
import type { ProjectDetail, MediaManifest } from '../contracts/projects';
import { errorMessage } from '../contracts/messages';
import { VideoFilePicker } from '../media/VideoFilePicker';
import type { SelectedVideo } from '../media/video-file-access';
import { createMediaManifest } from '../media/media-manifest';
import { loadEmptyDocument } from '../project-data/ass-api';
import { readSrtFile, importSubtitleFile } from '../project-data/subtitle-api';
import type { JsonRequest } from '../contracts/http';
import type { ImportStyle, ScriptSettings } from '../contracts/styles';
import type { AssDocument } from '../contracts/subtitles';
import { TemplateImportSelection } from '../style-ui/TemplateImportSelection';
import { ScriptSettingsEditor } from '../style-ui/StyleFieldsEditor';
import type { projectApi } from '../project-data/projects-api';

export function ProjectForm({ organization, api, request, onClose, onSaved }: {
  organization: Organization; api: ReturnType<typeof projectApi>; request: JsonRequest;
  onClose: () => void; onSaved: (project: ProjectDetail, video?: SelectedVideo) => void;
}) {
  useLocale();
  const [reference, setReference] = useState<{ name: string; source: string } | null>(null);
  const [referenceError, setReferenceError] = useMessageState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [media, setMedia] = useState<MediaManifest | null>(null);
  const selectedFile = useRef<SelectedVideo | undefined>(undefined);
  const [fileName, setFileName] = useState('');
  const subtitleInput = useRef<HTMLInputElement>(null);
  const [subtitle, setSubtitle] = useState<{ name: string; document: AssDocument | null } | null>(null);
  const [subtitleError, setSubtitleError] = useMessageState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [scriptOverride, setScriptOverride] = useState<ScriptSettings | null>(null);
  const [styleImports, setStyleImports] = useState<ImportStyle[]>([]);
  const [emptyDocument, setEmptyDocument] = useState<AssDocument | null>(null);
  const initialDocument = subtitle?.document ?? emptyDocument;
  const script = scriptOverride ?? initialDocument?.script;
  const subtitleNeedsValidation = subtitle !== null && subtitle.document === null;
  useEffect(() => {
    let active = true;
    void loadEmptyDocument().then(document => { if (active) setEmptyDocument(document); })
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
    finally {
      if (controller.current === task) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  async function inspectSubtitle(file: File) {
    const origin = captureDiagnosticOrigin();
    setBusy(true);
    setSubtitleError('');
    setScriptOverride(null);
    setSubtitle({ name: file.name, document: null });
    try {
      const document = await importSubtitleFile(file);
      setSubtitle({ name: file.name, document });
    } catch (reason) {
      reportFailure('project-ui', 'handled_error', reason, origin);
      setSubtitleError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={t("projectUi.newProject")} onClose={busy ? undefined : onClose}>
    <form className="account-form" onSubmit={event => {
      event.preventDefault();
      if (busy || subtitleNeedsValidation) return;
      const origin = captureDiagnosticOrigin();
      setError('');
      if (!media) { setError(msg("projectUi.finishVideoVerification")); return; }
      setBusy(true);
      void api.create({ name, description, media, source: subtitle?.document?.source ?? null, reference_source: reference?.source ?? null, style_imports: styleImports, ...(scriptOverride ? { script: scriptOverride } : {}) })
        .then(value => onSaved(value, selectedFile.current)).catch(reason => { reportFailure('project-ui', 'handled_error', reason, origin); setError(reason); }).finally(() => setBusy(false));
    }}>
      <p>{t("projectUi.organizationLabel", { name: organization.name })}</p>
      <label>{t("projectUi.projectName")}<input disabled={busy} value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></label>
      <label>{t("projectUi.projectDescription")}<textarea aria-label={t("projectUi.projectDescription")} disabled={busy} value={description} maxLength={2000} rows={3} onChange={event => setDescription(event.target.value)} /></label>
      <div className="controls">
        <span>{t("projectUi.referenceVideo")}</span>
        <VideoFilePicker label={t("projectUi.referenceVideo")} disabled={busy} onSelect={value => void inspect(value)} onError={setError}>{t("projectUi.chooseReferenceVideo")}</VideoFilePicker>
      </div>
      {fileName && <p>{fileName} · {media ? t("projectUi.fullVerificationPassed") : t("projectUi.verificationProgressValue", { v0: Math.round(progress * 100) })}</p>}
      {busy && controller.current && <button type="button" onClick={() => {
        controller.current?.abort();
        controller.current = null;
        setBusy(false);
        setFileName('');
      }}>{t("projectUi.cancelVerification")}</button>}
      <div className="controls">
        <span>{t("projectUi.initialSubtitlesOptional")}</span>
        <label className="file-picker">
          {subtitle ? t("projectUi.replaceAssFile") : t("projectUi.chooseAssFile")}
          <input ref={subtitleInput} type="file" accept=".ass,.srt" disabled={busy} aria-invalid={Boolean(subtitleError)} onChange={event => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            event.currentTarget.value = '';
            void inspectSubtitle(file);
          }} />
        </label>
        {subtitle && <button type="button" disabled={busy} onClick={() => {
          setSubtitle(null);
          setSubtitleError('');
          setScriptOverride(null);
          subtitleInput.current?.focus();
        }}>{t("projectUi.removeAssFile")}</button>}
        {subtitle && <span className="project-form-subtitle-file" role="status">
          {subtitle.document ? t("projectUi.subtitleValidated", { name: subtitle.name }) : subtitle.name}
        </span>}
      </div>
      {subtitle?.document && /\.srt$/i.test(subtitle.name) && <p role="status">{t('srt.importNotice')}</p>}
      {subtitleError && <p className="error" role="alert">{subtitleError}</p>}
      <div className="account-form">
        <span>{t('reference.optional')}</span>
        <p className="hint">{t('reference.help')}</p>
        <div className="controls">
          <ReferenceFileField disabled={busy} onFile={file => {
            setBusy(true); setReferenceError('');
            void readSrtFile(file).then(source => setReference({ name: file.name, source }))
              .catch(setReferenceError).finally(() => setBusy(false));
          }} />
          {reference && <><span>{reference.name}</span><button type="button" disabled={busy} onClick={() => { setReference(null); setReferenceError(''); }}>{t('reference.clear')}</button></>}
        </div>
        {referenceError && <p role="alert" className="error">{referenceError}</p>}
      </div>
      <fieldset disabled={busy}>
        <details><summary>{t("projectUi.styleTemplatesAndScriptSettingsOptional")}</summary>
          {script && <ScriptSettingsEditor value={script} onChange={setScriptOverride} />}
          <TemplateImportSelection request={request} organizationId={organization.id} value={styleImports} onChange={setStyleImports} existing={initialDocument?.styles} />
        </details>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="controls">
        <button type="button" disabled={busy} onClick={onClose}>{t("projectUi.cancel")}</button>
        <button className="primary" disabled={busy || !media || subtitleNeedsValidation}>
          {busy ? t("projectUi.processing") : t("projectUi.createAndOpen")}
        </button>
      </div>
    </form>
  </Modal>;
}
