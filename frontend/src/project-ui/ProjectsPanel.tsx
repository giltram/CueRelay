import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Organization } from '../account-ui/api';
import type { JsonRequest } from '../contracts/http';
import { Modal } from '../account-ui/Modal';
import type { ProjectDetail, ProjectPage, ProjectSummary } from '../contracts/projects';
import { projectApi } from '../project-data/projects-api';
import { ProjectForm } from './ProjectForm';
import { RouteLink } from '../navigation/RouteLink';
import { HomeLink } from '../navigation/HomeLink';
import type { Route } from '../navigation/routes';

export function ProjectsPanel({ organization, request, header, enabled, navigate, onCreate, onCreated, onLifecycle, unavailableOrganization }: {
  organization: Organization | undefined; request: JsonRequest; header: ReactNode; enabled: boolean;
  navigate: (route: Route) => void; onCreate: (open: () => void) => void;
  onCreated: (project: ProjectDetail, video?: File) => void; onLifecycle: (project: ProjectSummary) => void;
  unavailableOrganization?: boolean;
}) {
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<(ProjectPage & { context: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const context = `${status}:${query}:${page}`;
  const data = loaded?.context === context ? loaded : null;
  const api = useMemo(() => projectApi(request, organization?.id ?? 0), [request, organization?.id]);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const version = ++sequence.current;
    if (!organization || !enabled) return;
    setLoading(true); setError('');
    void api.list(status, query, page).then(value => {
      if (sequence.current !== version) return;
      const lastPage = Math.max(1, Math.ceil(value.total / 25));
      if (page > lastPage) setPage(lastPage);
      else setLoaded({ ...value, context });
    })
      .catch(reason => { if (sequence.current === version) setError(reason.message); })
      .finally(() => { if (sequence.current === version) setLoading(false); });
    return () => { sequence.current++; };
  }, [api, organization, status, query, page, refresh, enabled]);
  function saved(project: ProjectDetail, video?: File) {
    setCreating(false); setRefresh(value => value + 1);
    onCreated(project, video);
  }
  const person = (user: { username: string } | null) => user?.username || '—';
  const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
  return <main className="projects-page">
    <header className="app-header"><h1><HomeLink navigate={navigate} /></h1>{header}</header>
    <div className="project-heading"><h2>项目</h2><div className="controls">
      <RouteLink className="button-link" route={{ kind: 'local', organizationId: organization?.id }} navigate={navigate}>本地工作区</RouteLink>
      {organization?.can_manage && <button className="primary" disabled={!enabled || busy} onClick={() => onCreate(() => setCreating(true))}>新建项目</button>}
    </div></div>
    {organization ? <>
      <div className="project-filters">
        <div className="project-tabs" role="tablist" aria-label="项目状态">
          <button role="tab" aria-selected={status === 'active'} onClick={() => { setStatus('active'); setPage(1); }}>进行中</button>
          <button role="tab" aria-selected={status === 'archived'} onClick={() => { setStatus('archived'); setPage(1); }}>过去项目</button>
        </div>
        <label>搜索项目<input type="search" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder="按项目名称搜索" /></label>
      </div>
      {loading && <p role="status">正在加载项目…</p>}
      {error && <div className="error" role="alert">{error}<button onClick={() => setRefresh(value => value + 1)}>重试</button></div>}
      {!error && data && <div className="project-table-scroll"><table className="project-table"><thead><tr>
        <th>项目</th><th>{status === 'active' ? '最近更新' : '归档时间'}</th><th>{status === 'active' ? '更新者' : '归档人'}</th><th>操作</th>
      </tr></thead><tbody>{data.projects.map(project => <tr key={project.id}>
        <td><RouteLink className="project-name" route={{ kind: 'project', organizationId: project.organization_id, projectId: project.id }} navigate={navigate}>{project.name}</RouteLink>
          {project.description && <p className="project-description">{project.description}</p>}</td>
        <td>{date(status === 'active' ? project.updated_at : project.archived_at)}</td>
        <td>{person(status === 'active' ? project.updated_by : project.archived_by)}</td>
        <td><div className="controls">
          <RouteLink className="button-link" route={{ kind: 'project-settings', organizationId: project.organization_id, projectId: project.id }} navigate={navigate}>项目设置</RouteLink>
          {organization.can_manage && <>
            <button disabled={!enabled || busy} onClick={() => { setConfirm(project); setError(''); }}>{status === 'active' ? '归档项目' : '恢复项目'}</button>
          </>}
        </div></td>
      </tr>)}</tbody></table>
        {data.projects.length === 0 && <div className="empty">
          {query ? <><p>没有找到匹配的项目。</p><button onClick={() => setSearch('')}>清除搜索</button></> :
            <p>{status === 'archived' ? '暂无已归档项目。' : organization.can_manage ? '暂无进行中的项目，可以新建项目。' : '当前组织暂无进行中的项目。'}</p>}
        </div>}
      </div>}
      {data && <div className="project-pagination"><span>共 {data.total} 个项目 · 第 {data.page} 页</span><div className="controls">
        <button disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>上一页</button>
        <button disabled={loading || !data.has_more} onClick={() => setPage(value => value + 1)}>下一页</button>
      </div></div>}
    </> : <div className="empty"><p role={unavailableOrganization ? 'alert' : undefined}>{unavailableOrganization
      ? '指定组织不存在或无权访问，请选择可访问的组织。'
      : '暂无组织。请联系 dev 或 organizer 添加成员；仍可进入本地工作区处理字幕。'}</p>
      {unavailableOrganization && <RouteLink target="_self" route={{ kind: 'projects' }} navigate={navigate}>选择可访问的组织</RouteLink>}
    </div>}
    {organization && creating && <ProjectForm api={api} organization={organization} request={request}
      onClose={() => setCreating(false)} onSaved={saved} />}
    {confirm && <Modal title={confirm.status === 'active' ? '归档项目' : '恢复项目'} showCloseButton={confirm.status !== 'active'} onClose={busy ? undefined : () => setConfirm(null)}>
      <p>{confirm.status === 'active' ? `归档「${confirm.name}」后所有成员只能查看和导出，尚未保存的稿件不会自动提交。` : `恢复「${confirm.name}」后，组织成员可以继续工作。`}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="controls"><button disabled={busy} onClick={() => setConfirm(null)}>取消</button>
        <button className="primary" disabled={busy} onClick={() => {
          setBusy(true); setError('');
          void api.archive(confirm, confirm.status === 'active').then(project => { onLifecycle(project); setConfirm(null); setRefresh(value => value + 1); })
            .catch(reason => setError(reason.message)).finally(() => setBusy(false));
        }}>{confirm.status === 'active' ? '确认归档' : '确认恢复'}</button>
      </div>
    </Modal>}
  </main>;
}
