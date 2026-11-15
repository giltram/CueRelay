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
import { orderCues } from '../subtitle-model/cue-order';

/** Metadata and styles share one saved project snapshot/CAS, independent of any editor. */
export function ProjectSettingsPage({ organization, organizationId, projectId, request, header, enabled, navigate }: {
  organization?: Organization; organizationId: number; projectId: number; request: JsonRequest;
  header: ReactNode; enabled: boolean; navigate: (route: Route) => void;
}) {
  const api = useMemo(() => projectApi(request, organizationId), [request, organizationId]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [metadataNeedsReview, setMetadataNeedsReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stylesOpen, setStylesOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const cueRows = useMemo(() => orderCues(project?.document.cues ?? []), [project?.document.cues]);
  useEffect(() => {
    if (!enabled || !organization || project) return;
    let active = true;
    setError('');
    void api.get(projectId).then(value => {
      if (active) { setProject(value); setName(value.name); setDescription(value.description); }
    }).catch(reason => { if (active) setError(reason.message); });
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
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin); setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function saveMetadata() {
    if (!project || !enabled || busy || !organization?.can_manage || project.status !== 'active') return;
    if (metadataNeedsReview) {
      setError('项目名称或说明已被其他操作更新，请点击「刷新项目版本」核对后再保存；当前输入已保留。');
      return;
    }
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError(''); setMessage('');
    try {
      const latest = await api.update(project, name, description);
      setProject(latest); setName(latest.name); setDescription(latest.description);
      setMetadataNeedsReview(false);
      setMessage('项目设置已保存。');
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin); setError((reason as Error).message); }
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
      setMessage(`当前服务器版本：${latest.name}；说明：${latest.description || '无'}。你的输入已保留，请核对后再保存。`);
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin); setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function changeStyles(operation: StyleOperation): Promise<StyleResult> {
    if (!project || !enabled || busy || project.status !== 'active') throw new Error('当前项目不可修改样式。');
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveProjectStyles(api, project, operation);
      adoptProject(result.project);
      setMessage('项目样式已保存。工作区下次保存时会尝试合并新样式。');
      return result;
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin);
      if ((reason as { code?: string }).code === 'project_archived') setProject({ ...project, status: 'archived' });
      throw reason;
    } finally { setBusy(false); }
  }

  return <PageLayout className="settings-page" title={<HomeLink navigate={navigate} />} navigation={header}>
    <h2 className="settings-title">项目设置</h2>
    <section className="settings-content project-settings-form" aria-label="项目设置">
      {!organization ? <HeaderNotice role="alert">组织不存在或无权访问。</HeaderNotice>
        : project ? <>
          {organization.can_manage ? <form className="account-form" onSubmit={event => { event.preventDefault(); void saveMetadata(); }}>
            <h2>项目信息</h2>
            {project.status === 'archived' && <HeaderNotice>项目已归档，恢复后才能修改项目设置。</HeaderNotice>}
            <fieldset className="account-form" disabled={!enabled || busy || project.status !== 'active'}>
              <label>项目名称<input value={name} maxLength={100} required onChange={event => { setName(event.target.value); setMessage(''); }} /></label>
              <label>项目说明<textarea aria-label="项目说明" value={description} maxLength={2000} rows={5} onChange={event => { setDescription(event.target.value); setMessage(''); }} /></label>
              <div className="controls"><button className="primary">{busy ? '处理中…' : '保存修改'}</button></div>
            </fieldset>
          </form> : <div className="account-form"><h2>{project.name}</h2>
            <p>只有组织管理员可以修改项目名称和说明。</p></div>}
          <section className="account-form" aria-label="项目样式">
            <h2>项目样式</h2>
            <p className="hint">共 {project.document.styles.length} 个样式。使用已保存的字幕快照；其他工作区未保存的字幕和时间输入不会被提交。工作区下次保存时会尝试合并新样式。</p>
            {project.status === 'archived' && <p className="hint">项目已归档，样式仅可查看。</p>}
            <div className="controls"><button disabled={!enabled || busy} onClick={() => void openStyles()}>管理项目样式</button></div>
          </section>
          <GlossarySettings request={request} organizationId={organizationId} projectId={projectId}
            enabled={enabled} archived={project.status === 'archived'} canManage={organization.can_manage} />
          <div className="controls"><button disabled={!enabled || busy} onClick={() => void refreshProject()}>刷新项目版本</button></div>
          {message && <HeaderNotice>{message}</HeaderNotice>}
          {error && <HeaderNotice className="header-error" role="alert">{error}</HeaderNotice>}
        </> : error ? <div className="account-form"><HeaderNotice className="header-error" role="alert">{error}</HeaderNotice>
          <button disabled={!enabled} onClick={() => setRetry(value => value + 1)}>重试</button></div>
        : <HeaderNotice>正在加载项目…</HeaderNotice>}
    </section>
    {stylesOpen && project && <ProjectStyleManager document={project.document} cueRows={cueRows} selectedCueId={null}
      editable={enabled && project.status === 'active'} persisted request={request} organizationId={organizationId}
      canManageTemplates={organization?.can_manage} projectName={project.name} onApply={changeStyles} onClose={() => setStylesOpen(false)} />}
  </PageLayout>;
}
