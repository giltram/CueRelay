import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Organization } from '../account-ui/api';
import type { JsonRequest } from '../contracts/http';
import type { ProjectSummary } from '../contracts/projects';
import { HomeLink } from '../navigation/HomeLink';
import { RouteLink } from '../navigation/RouteLink';
import type { Route } from '../navigation/routes';
import { projectApi } from '../project-data/projects-api';

/** Loads metadata independently of the retained subtitle workspace. */
export function ProjectSettingsPage({ organization, organizationId, projectId, request, header, enabled, navigate }: {
  organization?: Organization; organizationId: number; projectId: number; request: JsonRequest;
  header: ReactNode; enabled: boolean; navigate: (route: Route) => void;
}) {
  const api = useMemo(() => projectApi(request, organizationId), [request, organizationId]);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !organization?.can_manage || project) return;
    let active = true;
    setError('');
    void api.get(projectId).then(value => { if (active) setProject(value); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [api, projectId, enabled, organization?.can_manage, project, retry]);

  return <main className="settings-page">
    <header className="app-header"><h1><HomeLink navigate={navigate} /></h1>{header}</header>
    <h2 className="settings-title">项目设置</h2>
    <section className="settings-content project-settings-form" aria-label="项目设置">
      {!organization ? <p role="alert">组织不存在或无权访问。</p>
        : !organization.can_manage ? <p role="alert">只有组织管理员可以修改项目设置。</p>
        : project ? <ProjectSettingsForm project={project} api={api} enabled={enabled} />
        : error ? <div className="account-form"><p className="error" role="alert">{error}</p>
          <button disabled={!enabled} onClick={() => setRetry(value => value + 1)}>重试</button></div>
        : <p role="status">正在加载项目…</p>}
      <div className="controls"><RouteLink target="_self" className="button-link"
        route={{ kind: 'projects', organizationId }} navigate={navigate}>返回项目列表</RouteLink></div>
    </section>
  </main>;
}

function ProjectSettingsForm({ project, api, enabled }: {
  project: ProjectSummary; api: ReturnType<typeof projectApi>; enabled: boolean;
}) {
  const [baseProject, setBaseProject] = useState(project);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const editable = baseProject.status === 'active';
  return <form className="account-form" onSubmit={event => {
    event.preventDefault();
    if (!enabled || busy || !editable) return;
    setBusy(true); setError(''); setMessage('');
    void api.update(baseProject, name, description).then(value => {
      setBaseProject(value); setName(value.name); setDescription(value.description);
      setMessage('项目设置已保存。');
    }).catch(reason => setError(reason.message)).finally(() => setBusy(false));
  }}>
    {!editable && <p role="status">项目已归档，恢复后才能修改项目设置。</p>}
    <fieldset className="account-form" disabled={!enabled || busy || !editable}>
      <label>项目名称<input value={name} maxLength={100} required onChange={event => { setName(event.target.value); setMessage(''); }} /></label>
      <label>项目说明<textarea aria-label="项目说明" value={description} maxLength={2000} rows={5} onChange={event => { setDescription(event.target.value); setMessage(''); }} /></label>
      <div className="controls"><button className="primary">{busy ? '处理中…' : '保存修改'}</button></div>
    </fieldset>
    <div className="controls"><button type="button" disabled={!enabled || busy} onClick={() => {
      setBusy(true); setError(''); setMessage('');
      void api.get(project.id).then(latest => {
        setBaseProject(latest);
        setMessage(`当前服务器版本：${latest.name}；说明：${latest.description || '无'}。你的输入已保留，请核对后再保存。`);
      }).catch(reason => setError(reason.message)).finally(() => setBusy(false));
    }}>刷新项目版本</button></div>
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
