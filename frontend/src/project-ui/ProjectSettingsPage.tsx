import { useMessageState, useLocale } from '../i18n/react';
import { describe, MessageError } from "../contracts/messages";
import { msg, t } from "../i18n";
import { PageLayout, HeaderNotice } from '../page-ui/PageLayout';
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Organization } from '../account-ui/api';
import type { JsonRequest } from '../contracts/http';
import type { ProjectDetail } from '../contracts/projects';
import type { StyleOperation } from '../contracts/styles';
import type { StyleResult } from '../contracts/subtitles';
import { HomeLink } from '../navigation/HomeLink';
import type { Route } from '../navigation/routes';
import { projectApi } from '../project-data/projects-api';
import { saveProjectStyles } from '../project-data/project-style-save';
import { GlossarySettings } from '../glossary-ui/GlossarySettings';
import { ProjectStyleManager } from '../style-ui/ProjectStyleManager';
import { permits } from '../contracts/permissions';
import { orderCues } from '../subtitle-model/cue-order';

/** Metadata and styles share one saved project snapshot/CAS, independent of any editor. */
export function ProjectSettingsPage({ organization, organizationId, projectId, request, header, enabled, navigate }: {
  organization?: Organization; organizationId: number; projectId: number; request: JsonRequest;
  header: ReactNode; enabled: boolean; navigate: (route: Route) => void;
}) {
  useLocale();
  const api = useMemo(() => projectApi(request, organizationId), [request, organizationId]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [metadataNeedsReview, setMetadataNeedsReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState('');
  const [message, setMessage] = useMessageState('');
  const [stylesOpen, setStylesOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const cueRows = useMemo(() => orderCues(project?.document.cues ?? []), [project?.document.cues]);
  useEffect(() => {
    if (!enabled || !organization || project) return;
    let active = true;
    setError('');
    void api.get(projectId).then(value => {
      if (active) { setProject(value); setName(value.name); setDescription(value.description); }
    }).catch(reason => { if (active) setError(reason); });
    return () => { active = false; };
  }, [api, projectId, enabled, organization, project, retry]);

  function adoptProject(latest: ProjectDetail) {
    // Refresh pristine metadata, but preserve explicit name/description drafts.
    // Advancing the style revision must not silently authorize a metadata overwrite.
    const nameConflict = project && name !== project.name && latest.name !== project.name && name !== latest.name;
    const descriptionConflict = project && description !== project.description
      && latest.description !== project.description && description !== latest.description;
    if (nameConflict || descriptionConflict) setMetadataNeedsReview(true);
    setName(value => value === project?.name ? latest.name : value);
    setDescription(value => value === project?.description ? latest.description : value);
    setProject(latest);
  }

  async function openStyles() {
    if (!project || !enabled || busy) return;
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError(''); setMessage('');
    try {
      const latest = await api.get(project.id);
      adoptProject(latest);
      setStylesOpen(true);
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin); setError(reason as Error); }
    finally { setBusy(false); }
  }

  async function saveMetadata() {
    if (!project || !enabled || busy || !permits(organization, 'edit_project') || project.status !== 'active') return;
    if (metadataNeedsReview) {
      setError(msg("projectUi.theProjectNameOrDescriptionChangedElsewhereRefresh"));
      return;
    }
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError(''); setMessage('');
    try {
      const latest = await api.update(project, name, description);
      setProject(latest); setName(latest.name); setDescription(latest.description);
      setMetadataNeedsReview(false);
      setMessage(msg("projectUi.projectSettingsSaved"));
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin); setError(reason as Error); }
    finally { setBusy(false); }
  }

  async function refreshProject() {
    if (!project || !enabled || busy) return;
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError(''); setMessage('');
    try {
      const latest = await api.get(project.id);
      setProject(latest);
      setMetadataNeedsReview(false);
      setMessage(msg("projectUi.currentServerNameValueDescriptionValueYourInputs", { v0: latest.name, v1: latest.description || msg('projectUi.none') }));
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin); setError(reason as Error); }
    finally { setBusy(false); }
  }

  async function changeStyles(operation: StyleOperation): Promise<StyleResult> {
    if (!project || !enabled || busy || project.status !== 'active') throw new MessageError(describe("projectUi.projectStylesCannotBeChangedRightNow", "当前项目不可修改样式。"));
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveProjectStyles(api, project, operation);
      adoptProject(result.project);
      setMessage(msg("projectUi.projectStylesSavedTheWorkspaceWillTryTo"));
      return result;
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin);
      if ((reason as { code?: string }).code === 'project_archived') setProject({ ...project, status: 'archived' });
      throw reason;
    } finally { setBusy(false); }
  }

  return <PageLayout className="settings-page" title={<HomeLink navigate={navigate} />} navigation={header}>
    <h2 className="settings-title">{t("projectUi.projectSettings")}</h2>
    <section className="settings-content project-settings-form" aria-label={t("projectUi.projectSettings")}>
      {!organization ? <HeaderNotice role="alert">{t("projectUi.organizationNotFoundOrAccessDenied")}</HeaderNotice>
        : project ? <>
          {permits(organization, 'edit_project') ? <form className="account-form" onSubmit={event => { event.preventDefault(); void saveMetadata(); }}>
            <h2>{t("projectUi.projectInformation")}</h2>
            {project.status === 'archived' && <HeaderNotice>{t("projectUi.thisProjectIsArchivedRestoreItBeforeChanging")}</HeaderNotice>}
            <fieldset className="account-form" disabled={!enabled || busy || project.status !== 'active'}>
              <label>{t("projectUi.projectName")}<input value={name} maxLength={100} required onChange={event => { setName(event.target.value); setMessage(''); }} /></label>
              <label>{t("projectUi.projectDescription")}<textarea aria-label={t("projectUi.projectDescription")} value={description} maxLength={2000} rows={5} onChange={event => { setDescription(event.target.value); setMessage(''); }} /></label>
              <div className="controls"><button className="primary">{busy ? t("projectUi.processing") : t("projectUi.saveChanges")}</button></div>
            </fieldset>
          </form> : <div className="account-form"><h2>{project.name}</h2>
            <p>{t("projectUi.onlyOrganizationAdministratorsCanChangeTheProjectName")}</p></div>}
          <section className="account-form" aria-label={t("projectUi.projectStyles")}>
            <h2>{t("projectUi.projectStyles")}</h2>
            <p className="hint">{t("projectUi.styleCount", { count: project.document.styles.length })}</p>
            {project.status === 'archived' && <p className="hint">{t("projectUi.thisProjectIsArchivedStylesAreReadOnly")}</p>}
            <div className="controls"><button disabled={!enabled || busy} onClick={() => void openStyles()}>{t("projectUi.manageProjectStyles")}</button></div>
          </section>
          <GlossarySettings request={request} organizationId={organizationId} projectId={projectId}
            enabled={enabled} archived={project.status === 'archived'} canUseOrganizationDefault={permits(organization, 'use_organization_glossary')} canFork={permits(organization, 'fork_project_glossary')} editable={permits(organization, 'edit_project_glossary')} />
          <div className="controls"><button disabled={!enabled || busy} onClick={() => void refreshProject()}>{t("projectUi.refreshProjectVersion")}</button></div>
          {message && <HeaderNotice>{message}</HeaderNotice>}
          {error && <HeaderNotice className="header-error" role="alert">{error}</HeaderNotice>}
        </> : error ? <div className="account-form"><HeaderNotice className="header-error" role="alert">{error}</HeaderNotice>
          <button disabled={!enabled} onClick={() => setRetry(value => value + 1)}>{t("projectUi.retry")}</button></div>
        : <HeaderNotice>{t("projectUi.loadingProject")}</HeaderNotice>}
    </section>
    {stylesOpen && project && <ProjectStyleManager document={project.document} cueRows={cueRows} selectedCueId={null}
      editable={enabled && project.status === 'active' && permits(organization, 'manage_project_styles')} canEditSubtitles={enabled && project.status === 'active' && permits(organization, 'edit_subtitles')} persisted request={request} organizationId={organizationId}
      canCreateTemplate={enabled && project.status === 'active' && permits(organization, 'create_style_template')} projectName={project.name} onApply={changeStyles} onClose={() => setStylesOpen(false)} />}
  </PageLayout>;
}
