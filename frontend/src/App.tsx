import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorWorkbench, type WorkbenchHandle } from './workspace-ui/EditorWorkbench';
import { createAccountApi, type Organization, type Settings, type User } from './account-ui/api';
import { LoginForm } from './account-ui/LoginForm';
import { Modal } from './account-ui/Modal';
import { MembersPanel } from './account-ui/MembersPanel';
import { PersonalPanel } from './account-ui/PersonalPanel';
import { ProjectsPanel } from './project-ui/ProjectsPanel';
import { projectApi } from './project-data/projects-api';
import type { ProjectDetail, ProjectSummary } from './contracts/projects';
import type { AssDocument } from './contracts/subtitles';

interface Transition { label: string; action: () => Promise<void> }

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  // Ownership outlives session validity. Never use authentication as the editor key.
  const [owner, setOwner] = useState<User | null>(null);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings>({ shortcut_overrides: {} });
  const [settingsReady, setSettingsReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [view, setView] = useState<'projects' | 'workspace'>('projects');
  const [workspace, setWorkspace] = useState<{ project?: ProjectDetail; initialMedia?: { file: File; sha256: string } } | null>(null);
  const [panel, setPanel] = useState<'login' | 'account' | 'members' | null>(null);
  const [transition, setTransition] = useState<Transition | null>(null);
  const transitionRef = useRef(transition); transitionRef.current = transition;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const workbench = useRef<WorkbenchHandle>(null);
  const epoch = useRef(0);
  const [accountApi] = useState(() => createAccountApi(() => {
    epoch.current++; setUser(null); setPanel('login');
  }));
  const { request: api, session, expectUser } = accountApi;
  const organization = organizations.find(org => org.id === organizationId);

  const loadContext = useCallback(async (selectInitial = false) => {
    const version = epoch.current;
    const [orgs, preferences] = await Promise.all([
      api<{ organizations: Organization[] }>('/organizations'), api<Settings>('/me/settings'),
    ]);
    if (epoch.current !== version) return;
    setOrganizations(orgs.organizations); setSettings(preferences); setSettingsReady(true);
    if (selectInitial) setOrganizationId(orgs.organizations[0]?.id ?? null);
  }, [api]);

  const accept = useCallback(async (next: User) => {
    const previous = ownerRef.current;
    if (!previous || previous.id !== next.id) setSettingsReady(false);
    epoch.current++; expectUser(next.id);
    setUser(next); setOwner(next); ownerRef.current = next; setPanel(null); setMessage('');
    if (previous && previous.id !== next.id) {
      setWorkspace(null); setView('projects');
      setGeneration(value => value + 1); setSettings({ shortcut_overrides: {} });
    }
    try { await loadContext(!previous || previous.id !== next.id); }
    catch (reason) { setMessage((reason as Error).message); }
  }, [loadContext, expectUser]);

  const observe = useCallback(async () => {
    if (transitionRef.current) return;
    const version = epoch.current;
    try {
      const result = await session();
      if (version !== epoch.current) return;
      if (!result.user) {
        setUser(null);
      } else if (ownerRef.current && ownerRef.current.id !== result.user.id) {
        setUser(null); setPanel(null);
        const next = result.user;
        setTransition({ label: `切换到账号 ${next.username}`, action: () => accept(next) });
      } else if (ownerRef.current) {
        setUser(result.user); setOwner(result.user);
        await loadContext();
      } else {
        await accept(result.user);
      }
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setInitializing(false); }
  }, [accept, loadContext, session]);

  useEffect(() => {
    void observe();
    const focus = () => { if (document.visibilityState === 'visible') void observe(); };
    const timer = window.setInterval(focus, 30000);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      clearInterval(timer); window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [observe]);

  function requestTransition(label: string, action: () => Promise<void>, always = false) {
    setPanel(null); setMessage('');
    if (always || workbench.current?.hasContent()) setTransition({ label, action });
    else void execute(action);
  }
  async function execute(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); setTransition(null); }
    catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function exportDraft() {
    setBusy(true); setMessage('');
    try { await workbench.current?.exportDraft(); setMessage('已请求下载，请确认文件后再选择放弃或取消。'); }
    catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(false); }
  }
  function onLogin(next: User) {
    epoch.current++;
    if (owner && owner.id !== next.id) {
      setUser(null); setPanel(null);
      requestTransition(`切换到账号 ${next.username}`, () => accept(next), true);
    } else void accept(next);
  }
  async function exit() {
    await api('/auth/logout', 'POST', {});
    epoch.current++;
    setUser(null); setOwner(null); ownerRef.current = null; expectUser(null);
    setWorkspace(null); setView('projects');
    setSettings({ shortcut_overrides: {} }); setSettingsReady(false); setOrganizations([]); setOrganizationId(null); setPanel(null);
  }
  const header = <div className="account-toolbar">
    <label className="sr-only" htmlFor="organization">当前组织</label>
    <select id="organization" disabled={!user || busy} value={organizationId ?? ''} onChange={event => {
      const id = Number(event.target.value);
      requestTransition('切换组织', async () => {
        await api(`/organizations/${id}`);
        setOrganizationId(id); setWorkspace(null); setView('projects'); setGeneration(value => value + 1);
      });
    }}>
      {!organization && <option value={organizationId ?? ''}>{organizationId ? '原组织已不可访问' : '暂无组织'}</option>}
      {organizations.map(org => <option key={org.id} value={org.id}>{org.name} · {org.role || 'dev'}</option>)}
    </select>
    <button disabled={!user} aria-pressed={view === 'projects'} onClick={() => setView('projects')}>项目</button>
    {workspace && <button disabled={!user} aria-pressed={view === 'workspace'} onClick={() => setView('workspace')}>返回工作区</button>}
    {user ? <>
      {organization && <button onClick={() => setPanel('members')}>成员</button>}
      <button disabled={!settingsReady} onClick={() => setPanel('account')}>{user.display_name || user.username}{user.is_dev ? ' · dev' : ''}</button>
    </> : <button onClick={() => { void session().then(() => setPanel('login')).catch(reason => setMessage(reason.message)); }}>重新登录</button>}
  </div>;

  function openProject(project: ProjectSummary, video?: File, reload = false) {
    if (!reload && workspace?.project?.id === project.id) {
      setWorkspace(current => current?.project ? { ...current, project: { ...current.project, ...project } } : current);
      setView('workspace'); return;
    }
    requestTransition(reload ? '重新加载项目' : '打开其他项目', async () => {
      const detail = await projectApi(api, project.organization_id).get(project.id);
      setWorkspace({ project: detail, ...(video ? { initialMedia: { file: video, sha256: detail.media.sha256 } } : {}) });
      setGeneration(value => value + 1); setView('workspace');
    });
  }
  function openLocal() {
    if (workspace && !workspace.project) { setView('workspace'); return; }
    requestTransition('进入本地工作区', async () => {
      setWorkspace({}); setGeneration(value => value + 1); setView('workspace');
    });
  }
  async function saveProject(document: AssDocument, revision: number) {
    const project = workspace?.project;
    if (!project) throw new Error('尚未打开项目。');
    let summary: ProjectSummary;
    try { summary = await projectApi(api, project.organization_id).save({ ...project, revision }, document); }
    catch (reason) {
      if ((reason as { code?: string }).code === 'project_archived') {
        setWorkspace(current => current?.project?.id === project.id ? { ...current, project: { ...current.project, status: 'archived' } } : current);
      }
      throw reason;
    }
    setWorkspace(current => current?.project?.id === summary.id ? { ...current, project: { ...current.project, ...summary } } : current);
    return summary;
  }
  useEffect(() => {
    if (!workspace?.project || !user) return;
    const current = workspace.project;
    let active = true;
    const check = () => {
      void projectApi(api, current.organization_id).get(current.id).then(latest => {
        // Observe archive state without adopting a revision or replacing local inputs.
        if (active) setWorkspace(value => value?.project?.id === latest.id ? { ...value, project: { ...value.project, status: latest.status } } : value);
      }).catch(reason => { if (active) setMessage(reason.message); });
    };
    const timer = window.setInterval(check, 30000);
    window.addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [workspace?.project?.id, user?.id, api]);

  if (initializing) return <div className="login-page"><p role="status">正在检查会话…</p></div>;
  return <>
    {owner ? <>
      {view === 'projects' && <ProjectsPanel key={`${owner.id}:${organizationId ?? 'none'}`} organization={organization} request={api}
        header={header} enabled={Boolean(user && settingsReady && !busy)} onOpen={openProject} onLocal={openLocal} onLifecycle={summary => setWorkspace(current => current?.project?.id === summary.id ? { ...current, project: { ...current.project, ...summary } } : current)} />}
      {workspace && <div hidden={view !== 'workspace'}><EditorWorkbench key={generation} ref={workbench} header={view === 'workspace' ? header : null}
        visible={view === 'workspace'} project={workspace.project} initialMedia={workspace.initialMedia}
        readOnly={Boolean(workspace.project && (workspace.project.status === 'archived' || !user))}
        onSave={workspace.project ? saveProject : undefined}
        onReload={workspace.project ? () => openProject(workspace.project!, undefined, true) : undefined}
        shortcutOverrides={settings.shortcut_overrides} shortcutsPaused={Boolean(view !== 'workspace' || panel || transition || !user || !settingsReady)} /></div>}
    </> : <div className="login-page"><h1>CueRelay</h1><p>内部账号由站点管理员创建。</p>
      <LoginForm api={accountApi} onLogin={onLogin} /></div>}
    {owner && !user && <div className="session-notice" role="status">会话已失效或账号已变更。字幕、时间输入和视频保留在本页，请重新登录。</div>}
    {owner && user && organizations.length === 0 && <div className="session-notice">暂无组织。请联系 dev 或 organizer 添加成员；仍可使用本地工作区。</div>}
    {message && !transition && <div className="app-message" role="alert">{message}<button onClick={() => void observe()}>刷新会话与设置</button></div>}
    {owner && panel === 'login' && <Modal title="重新登录" onClose={() => setPanel(null)}>
      <LoginForm api={accountApi} onLogin={onLogin} expectedUsername={owner.username} />
    </Modal>}
    {user && panel === 'account' && <Modal title="个人设置" onClose={() => setPanel(null)}>
      <div className="controls"><span>{user.username}</span>
        {user.is_dev && <a href={import.meta.env.DEV ? 'http://127.0.0.1:8000/admin/' : '/admin/'} target="_blank" rel="noreferrer">Django Admin</a>}
        <button onClick={() => requestTransition('退出账号', exit)}>退出账号</button>
        <button onClick={() => requestTransition('切换账号', exit)}>切换账号</button>
      </div>
      <PersonalPanel request={api} key={user.id} user={user} settings={settings} onSettings={setSettings} onUser={next => { setUser(next); setOwner(next); }} />
    </Modal>}
    {user && organization && panel === 'members' && <Modal title="组织成员" onClose={() => setPanel(null)}>
      <MembersPanel currentUserId={user.id} request={api} organization={organization} onChanged={() => void loadContext().catch(reason => setMessage(reason.message))} onLeave={() => {
        requestTransition('退出此组织', async () => {
          await api(`/organizations/${organization.id}/leave`, 'POST', {});
          setOrganizationId(null); setWorkspace(null); setView('projects'); setGeneration(value => value + 1); await loadContext(true);
        }, true);
      }} />
    </Modal>}
    {transition && <Modal title={transition.label}>
      <p>继续将放弃当前本地字幕、尚未应用的时间输入和视频。导出包含已应用的字幕；请取消后应用需要保留的时间输入，再导出。</p>
      <p>导出后仍会停留在此处，确认下载后再明确放弃。</p>
      <div className="controls">
        <button disabled={busy} onClick={() => void exportDraft()}>导出 ASS</button>
        <button disabled={busy} onClick={() => { setTransition(null); setMessage(''); if (!user) setPanel('login'); }}>取消</button>
        <button disabled={busy} onClick={() => void execute(transition.action)}>明确放弃并继续</button>
      </div>
      {message && <p role="status">{message}</p>}
    </Modal>}
  </>;
}
