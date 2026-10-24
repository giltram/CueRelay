import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorWorkbench, type WorkbenchHandle } from './workspace-ui/EditorWorkbench';
import { createAccountApi, createDefaultSettings, type Organization, type Settings, type User } from './account-ui/api';
import { LoginForm } from './account-ui/LoginForm';
import { Modal } from './account-ui/Modal';
import { SettingsPage } from './account-ui/SettingsPage';
import { ProjectsPanel } from './project-ui/ProjectsPanel';
import { ProjectSettingsPage } from './project-ui/ProjectSettingsPage';
import { useNavigation } from './navigation/use-navigation';
import { RouteLink } from './navigation/RouteLink';
import { HomeLink } from './navigation/HomeLink';
import { RouteStatus } from './navigation/RouteStatus';
import { routeOrganization, routePath, type Route } from './navigation/routes';
import { useWorkspace } from './app-workspace/use-workspace';

interface Transition { label: string; action: () => Promise<void> }

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  // Ownership outlives session validity. Never use authentication as the editor key.
  const [owner, setOwner] = useState<User | null>(null);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganizationId, setOrganizationId] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings>(createDefaultSettings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [panel, setPanel] = useState<'login' | null>(null);
  const [transition, setTransition] = useState<Transition | null>(null);
  const transitionRef = useRef(transition); transitionRef.current = transition;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const workbench = useRef<WorkbenchHandle>(null);
  const epoch = useRef(0);
  const bypassNavigation = useRef(false);
  const { route, navigate } = useNavigation(requestNavigation);
  const routeRef = useRef(route); routeRef.current = route;
  const [accountApi] = useState(() => createAccountApi(() => {
    epoch.current++; setUser(null); setPanel('login');
  }));
  const { request: api, session, expectUser } = accountApi;
  const workspaceState = useWorkspace(route, api, Boolean(user && settingsReady), owner?.id, setMessage);
  const { workspace, visible } = workspaceState;
  const organizationId = routeOrganization(route) ?? selectedOrganizationId;
  const organization = organizations.find(org => org.id === organizationId);
  const isList = route.kind === 'projects' || route.kind === 'entry';
  const isSettings = route.kind === 'settings' || route.kind === 'organization-settings';

  // Only already-approved account changes and canonical entry redirects bypass
  // the route guard. User navigation always enters requestNavigation.
  const navigateApproved = useCallback((next: Route, replace = false) => {
    bypassNavigation.current = true;
    try { navigate(next, replace); } finally { bypassNavigation.current = false; }
  }, [navigate]);

  const loadContext = useCallback(async (selectInitial = false) => {
    const version = epoch.current;
    const [orgs, preferences] = await Promise.all([
      api<{ organizations: Organization[] }>('/organizations'), api<Settings>('/me/settings'),
    ]);
    if (epoch.current !== version) return;
    setOrganizations(orgs.organizations); setSettings(preferences); setSettingsReady(true);
    if (selectInitial) setOrganizationId(routeOrganization(routeRef.current) ?? orgs.organizations[0]?.id ?? null);
  }, [api]);

  const accept = useCallback(async (next: User) => {
    const previous = ownerRef.current;
    if (!previous || previous.id !== next.id) setSettingsReady(false);
    epoch.current++; expectUser(next.id);
    setUser(next); setOwner(next); ownerRef.current = next; setPanel(null); setMessage('');
    if (previous && previous.id !== next.id) {
      workspaceState.clear(); setSettings(createDefaultSettings());
      navigateApproved({ kind: 'entry' }, true);
    }
    try { await loadContext(!previous || previous.id !== next.id); }
    catch (reason) { setMessage((reason as Error).message); }
  }, [loadContext, expectUser, workspaceState.clear, navigateApproved]);

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

  useEffect(() => {
    const requested = routeOrganization(route);
    if (requested !== undefined) setOrganizationId(requested);
    if (!user || !settingsReady) return;
    if (route.kind === 'entry') {
      if (!organizations.some(org => org.id === selectedOrganizationId)) setOrganizationId(organizations[0]?.id ?? null);
    } else if (route.kind === 'projects' && route.organizationId === undefined) {
      const id = organizations.some(org => org.id === selectedOrganizationId) ? selectedOrganizationId : organizations[0]?.id;
      const target: Route = { kind: 'projects', ...(id ? { organizationId: id } : {}) };
      if (routePath(route) !== routePath(target)) navigateApproved(target, true);
    } else if (route.kind !== 'not-found' && window.location.pathname !== routePath(route)) {
      navigateApproved(route, true);
    }
  }, [route, user, settingsReady, organizations, selectedOrganizationId, navigateApproved]);

  function requestTransition(label: string, action: () => Promise<void>, always = false) {
    if (transitionRef.current) return;
    setPanel(null); setMessage('');
    if (always || workbench.current?.hasContent()) {
      const next = { label, action }; transitionRef.current = next; setTransition(next);
    } else void execute(action);
  }
  function requestNavigation(next: Route, commit: () => void) {
    if (bypassNavigation.current) { commit(); return; }
    if (transitionRef.current) return;
    const nextOrganization = routeOrganization(next);
    const changesOrganization = nextOrganization !== undefined && nextOrganization !== organizationId;
    const changesWorkspace = next.kind === 'project'
      ? workspace?.project?.id !== next.projectId || workspace.project.organization_id !== next.organizationId
      : next.kind === 'local' && Boolean(workspace?.project);
    const replaceWorkspace = changesOrganization || changesWorkspace;
    const action = async () => {
      if (replaceWorkspace) workspaceState.clear();
      if (nextOrganization !== undefined) setOrganizationId(nextOrganization);
      commit();
    };
    if (replaceWorkspace) requestTransition(changesOrganization ? '切换组织' : next.kind === 'local' ? '进入本地工作区' : '打开其他项目', action);
    else void action();
  }
  async function execute(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); transitionRef.current = null; setTransition(null); }
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
    workspaceState.clear(); navigateApproved({ kind: 'entry' }, true);
    setSettings(createDefaultSettings()); setSettingsReady(false); setOrganizations([]); setOrganizationId(null); setPanel(null);
  }
  const listRoute: Route = { kind: 'projects', organizationId: workspace?.project?.organization_id ?? organizationId ?? undefined };
  const header = <div className="account-toolbar">
    {isList && <><label className="sr-only" htmlFor="organization">当前组织</label>
    <select id="organization" disabled={!user || busy} value={organizationId ?? ''} onChange={event => {
      navigate({ kind: 'projects', organizationId: Number(event.target.value) });
    }}>
      {!organization && <option value={organizationId ?? ''}>{organizationId ? '原组织已不可访问' : '暂无组织'}</option>}
      {organizations.map(org => <option key={org.id} value={org.id}>{org.name} · {org.role || 'dev'}</option>)}
    </select></>}
    <RouteLink className="button-link" route={listRoute} navigate={navigate}
      aria-current={isList ? 'page' : undefined}>项目列表</RouteLink>
    {user ? <RouteLink className="button-link" route={{ kind: 'settings', organizationId: organizationId ?? undefined }} navigate={navigate}
      aria-current={isSettings ? 'page' : undefined}>设置</RouteLink>
      : <button onClick={() => { void session().then(() => setPanel('login')).catch(reason => setMessage(reason.message)); }}>重新登录</button>}
  </div>;
  const projectLoad = workspaceState.projectLoad;

  if (initializing) return <div className="login-page"><p role="status">正在检查会话…</p></div>;
  return <>
    {owner ? <>
      {isList && <ProjectsPanel key={`${owner.id}:${organizationId ?? 'none'}`} organization={organization} request={api}
        header={header} enabled={Boolean(user && settingsReady && !busy)} navigate={navigate}
        unavailableOrganization={organizationId !== null && !organization}
        onCreate={open => requestTransition('新建项目', async () => { workspaceState.clear(); open(); })}
        onCreated={(project, video) => {
          workspaceState.adoptCreated(project, video);
          navigateApproved({ kind: 'project', organizationId: project.organization_id, projectId: project.id });
        }} onLifecycle={workspaceState.updateSummary} />}
      {route.kind === 'project-settings' && <ProjectSettingsPage key={`${owner.id}:${route.organizationId}:${route.projectId}`}
        organization={organization} organizationId={route.organizationId} projectId={route.projectId}
        request={api} header={header} enabled={Boolean(user && settingsReady && !busy && !transition)} navigate={navigate} />}
      {isSettings && <SettingsPage user={user ?? owner} organization={organization}
        section={route.kind === 'organization-settings' ? 'organization' : 'personal'} header={header}
        enabled={Boolean(user && settingsReady && !busy && !transition)} ready={settingsReady}
        request={api} settings={settings} navigate={navigate} onSettings={setSettings}
        onExit={() => requestTransition('退出账号', exit)}
        onRetry={() => void loadContext().catch(reason => setMessage(reason.message))}
        onChanged={() => void loadContext().catch(reason => setMessage(reason.message))}
        onLeave={() => {
          if (!organization) return;
          requestTransition('退出此组织', async () => {
            await api(`/organizations/${organization.id}/leave`, 'POST', {});
            setOrganizationId(null); workspaceState.clear(); navigateApproved({ kind: 'projects' }, true); await loadContext(true);
          }, true);
        }} />}
      {(route.kind === 'not-found' || route.kind === 'project' && projectLoad?.status !== 'ready') &&
        <RouteStatus header={header} loading={route.kind === 'project' && projectLoad?.status === 'loading'}
          notFound={route.kind === 'not-found'} error={projectLoad?.error} organizationId={routeOrganization(route)} navigate={navigate}
          retry={route.kind === 'project' ? workspaceState.retry : undefined} exportDraft={workspace ? () => void exportDraft() : undefined} />}
      {workspace && <div hidden={!visible}><EditorWorkbench key={workspace.generation} ref={workbench} header={visible ? header : null} title={<HomeLink navigate={navigate} />}
        visible={visible} project={workspace.project} initialMedia={workspace.initialMedia}
        readOnly={Boolean(workspace.project && (workspace.project.status === 'archived' || !user || workspaceState.accessDenied))}
        onSave={workspace.project ? workspaceState.save : undefined}
        onReload={workspace.project ? () => requestTransition('重新加载项目', workspaceState.reload) : undefined}
        audioMode={settings.audio_display_mode} shortcutOverrides={settings.shortcut_overrides} shortcutsPaused={Boolean(!visible || panel || transition || !user || !settingsReady)} /></div>}
    </> : <div className="login-page"><h1><HomeLink navigate={navigate} /></h1><p>内部账号由站点管理员创建。</p>
      <LoginForm api={accountApi} onLogin={onLogin} /></div>}
    {owner && !user && <div className="session-notice" role="status">会话已失效或账号已变更。字幕、时间输入和视频保留在本页，请重新登录。</div>}
    {owner && user && organizations.length === 0 && <div className="session-notice">暂无组织。请联系 dev 或 organizer 添加成员；仍可使用本地工作区。</div>}
    {message && !transition && <div className="app-message" role="alert">{message}<button onClick={() => void observe()}>刷新会话与设置</button></div>}
    {owner && panel === 'login' && <Modal title="重新登录" onClose={() => setPanel(null)}>
      <LoginForm api={accountApi} onLogin={onLogin} expectedUsername={owner.username} />
    </Modal>}
    {transition && <Modal title={transition.label}>
      <p>继续将放弃当前本地字幕、尚未应用的时间输入和视频。导出包含已应用的字幕；请取消后应用需要保留的时间输入，再导出。</p>
      <p>导出后仍会停留在此处，确认下载后再明确放弃。</p>
      <div className="controls">
        <button disabled={busy} onClick={() => void exportDraft()}>导出 ASS</button>
        <button disabled={busy} onClick={() => { transitionRef.current = null; setTransition(null); setMessage(''); if (!user) setPanel('login'); }}>取消</button>
        <button disabled={busy} onClick={() => void execute(transition.action)}>明确放弃并继续</button>
      </div>
      {message && <p role="status">{message}</p>}
    </Modal>}
  </>;
}
