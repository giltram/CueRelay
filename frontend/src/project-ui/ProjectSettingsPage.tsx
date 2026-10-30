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

  async function saveMetadata() {
    if (!project || !enabled || busy || !organization?.can_manage || project.status !== 'active') return;
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError(''); setMessage('');
    try {
      const latest = await api.update(project, name, description);
      setProject(latest); setName(latest.name); setDescription(latest.description);
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
      setMessage(`当前服务器版本：${latest.name}；说明：${latest.description || '无'}。你的输入已保留，请核对后再保存。`);
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin); setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function changeStyles(operation: StyleOperation): Promise<StyleResult> {
    if (!project || !enabled || busy || project.status !== 'active') throw new Error('当前项目不可修改样式。');
    const origin = captureDiagnosticOrigin();
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.styles(project, project.document, operation);
      setProject({ ...project, ...result.project, document: result.document });
      setMessage('项目样式已保存。已打开的工作区需重新加载项目后使用新样式。');
      return result;
    } catch (reason) { reportFailure('project-ui', 'handled_error', reason, origin);
      if ((reason as { code?: string }).code === 'project_archived') setProject({ ...project, status: 'archived' });
      throw reason;
    } finally { setBusy(false); }
  }

  return <main className="settings-page">
    <header className="app-header"><h1><HomeLink navigate={navigate} /></h1>{header}</header>
    <h2 className="settings-title">项目设置</h2>
    <section className="settings-content project-settings-form" aria-label="项目设置">
      {!organization ? <p role="alert">组织不存在或无权访问。</p>
        : project ? <>
          {organization.can_manage ? <form className="account-form" onSubmit={event => { event.preventDefault(); void saveMetadata(); }}>
            <h2>项目信息</h2>
            {project.status === 'archived' && <p role="status">项目已归档，恢复后才能修改项目设置。</p>}
            <fieldset className="account-form" disabled={!enabled || busy || project.status !== 'active'}>
              <label>项目名称<input value={name} maxLength={100} required onChange={event => { setName(event.target.value); setMessage(''); }} /></label>
              <label>项目说明<textarea aria-label="项目说明" value={description} maxLength={2000} rows={5} onChange={event => { setDescription(event.target.value); setMessage(''); }} /></label>
              <div className="controls"><button className="primary">{busy ? '处理中…' : '保存修改'}</button></div>
            </fieldset>
          </form> : <div className="account-form"><h2>{project.name}</h2>
            <p>只有组织管理员可以修改项目名称和说明。</p></div>}
          <section className="account-form" aria-label="项目样式">
            <h2>项目样式</h2>
            <p className="hint">共 {project.document.styles.length} 个样式。使用已保存的字幕快照；其他工作区未保存的字幕和时间输入不会被提交。修改后，已打开的工作区需重新加载项目。</p>
            {project.status === 'archived' && <p className="hint">项目已归档，样式仅可查看。</p>}
            <div className="controls"><button disabled={!enabled || busy} onClick={() => setStylesOpen(true)}>管理项目样式</button></div>
          </section>
          <div className="controls"><button disabled={!enabled || busy} onClick={() => void refreshProject()}>刷新项目版本</button></div>
          {message && <p role="status">{message}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </> : error ? <div className="account-form"><p className="error" role="alert">{error}</p>
          <button disabled={!enabled} onClick={() => setRetry(value => value + 1)}>重试</button></div>
        : <p role="status">正在加载项目…</p>}
    </section>
    {stylesOpen && project && <ProjectStyleManager document={project.document} cueRows={cueRows} selectedCueId={null}
      editable={enabled && project.status === 'active'} persisted request={request} organizationId={organizationId}
      canManageTemplates={organization?.can_manage} projectName={project.name} onApply={changeStyles} onClose={() => setStylesOpen(false)} />}
  </main>;
}
