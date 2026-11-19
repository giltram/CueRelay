import { roleName } from './i18n/shortcuts';
import type { MessageValue } from './contracts/messages';
import { formatMessage, t, msg } from './i18n';
import { useLanguagePreference } from './i18n/use-language-preference';
import { useMessageState, useLocale } from './i18n/react';
import { PageLayout, HeaderNotice } from './page-ui/PageLayout';
import { diagnostics, provideAccountStatus } from './diagnostics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorWorkbench, type WorkbenchHandle } from './workspace-ui/EditorWorkbench';
import { ApiError, createAccountApi, createDefaultSettings, type Organization, type Settings, type User } from './account-ui/api';
import { LoginForm } from './account-ui/LoginForm';
import { Modal } from './page-ui/Modal';
import { SettingsPage } from './account-ui/SettingsPage';
import { HandbookPrompt } from './account-ui/HandbookPrompt';
import { HandbookPage } from './handbook-ui/HandbookPage';
import { ProjectsPanel } from './project-ui/ProjectsPanel';
import { ProjectSettingsPage } from './project-ui/ProjectSettingsPage';
import { useNavigation } from './navigation/use-navigation';
import { RouteLink } from './navigation/RouteLink';
import { HomeLink } from './navigation/HomeLink';
import { RouteStatus } from './navigation/RouteStatus';
import { routeOrganization, routePath, type Route } from './navigation/routes';
import { useWorkspace } from './app-workspace/use-workspace';
import './style-ui/style-management.css';
import { OrganizationGlossary } from './glossary-ui/OrganizationGlossary';
import { OrganizationStyleLibrary } from './style-ui/OrganizationStyleLibrary';
import { draftScope } from './workspace-drafts/model';
import { ReadOrder } from './request-state/read-order';

type TransitionAction = () => Promise<void | false>;
interface Transition { label: MessageValue; action: TransitionAction; afterSuccess?: () => Promise<void> }
interface OrganizationSnapshot {
  list: Organization[];
  readVersion: number;
  needsRefresh: boolean;
}
type ContextResource = 'organizations' | 'settings';

export default function App() {
  useLocale();
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  // Ownership outlives session validity. Never use authentication as the editor key.
  const [owner, setOwner] = useState<User | null>(null);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const [organizationSnapshot, setOrganizationSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [selectedOrganizationId, setOrganizationId] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings>(createDefaultSettings);
  const settingsVersions = useRef<Partial<Record<keyof Settings, number>>>({});
  const acceptSavedSettings = useCallback((changes: Partial<Settings>) => {
    for (const field of Object.keys(changes) as (keyof Settings)[]) {
      settingsVersions.current[field] = (settingsVersions.current[field] ?? 0) + 1;
    }
    setSettings(previous => ({ ...previous, ...changes }));
  }, []);
  const [settingsReady, setSettingsReady] = useState(false);
  const [handbookDismissedFor, setHandbookDismissedFor] = useState<number | null>(null);
  const [panel, setPanel] = useState<'login' | null>(null);
  const [transition, setTransition] = useState<Transition | null>(null);
  const transitionRef = useRef(transition); transitionRef.current = transition;
  const [message, setMessage] = useMessageState('');
  const [contextErrors, setContextErrors] = useState<Partial<Record<ContextResource | 'session', MessageValue>>>({});
  const [busy, setBusy] = useState(false);
  const workbench = useRef<WorkbenchHandle>(null);
  const epoch = useRef(0);
  const latestSessionRead = useRef(0);
  const contextReads = useRef({ organizations: new ReadOrder(), settings: new ReadOrder() });
  const bypassNavigation = useRef(false);
  const { route, navigate } = useNavigation(requestNavigation);
  const [accountApi] = useState(() => createAccountApi(() => {
    epoch.current++; setUser(null); setPanel('login');
  }));
  const { request: api, session, expectUser } = accountApi;
  const language = useLanguagePreference(user?.id ?? null, settingsReady, settings.language_preference, api,
    preference => acceptSavedSettings({ language_preference: preference }));
  const workspaceState = useWorkspace(route, api, Boolean(user), owner?.id, setMessage);
  const { workspace, visible } = workspaceState;
  const organizationId = routeOrganization(route) ?? selectedOrganizationId;
  const organizations = organizationSnapshot?.list ?? null;
  const organizationsReady = organizations !== null;
  const organization = organizations?.find(org => org.id === organizationId);
  useEffect(() => { diagnostics.setContext({ page: route.kind, organizationId: organizationId ?? undefined, projectId: 'projectId' in route ? route.projectId : undefined }); }, [route, organizationId]);
  useEffect(() => {
    if (!user) return;
    return provideAccountStatus(user.id, () => ({ id: user.id, username: user.username, is_dev: user.is_dev,
      organization: organization ? { id: organization.id, name: organization.name,
        role: organization.role, can_manage: organization.can_manage } : null }));
  }, [user, organization]);
  const isList = route.kind === 'projects' || route.kind === 'entry';
  const isSettings = route.kind === 'settings' || route.kind === 'organization-settings';
  const handbookPromptOpen = Boolean(user && settingsReady && settings.handbook_seen === false &&
    handbookDismissedFor !== user.id && route.kind !== 'handbook' && !panel && !transition);

  // Only already-approved account changes and canonical entry redirects bypass
  // the route guard. User navigation always enters requestNavigation.
  const navigateApproved = useCallback((next: Route, replace = false) => {
    bypassNavigation.current = true;
    try { navigate(next, replace); } finally { bypassNavigation.current = false; }
  }, [navigate]);

  const loadContext = useCallback(async () => {
    const version = epoch.current;
    const orders = contextReads.current;
    const reads = { organizations: orders.organizations.start(), settings: orders.settings.start() };
    const settingsReadVersions = { ...settingsVersions.current };
    const acceptData = (resource: ContextResource) =>
      epoch.current === version && orders[resource].acceptData(reads[resource]);
    const report = (resource: ContextResource, error?: MessageValue) => {
      if (error instanceof ApiError && error.code === 'request_superseded') return;
      if (epoch.current !== version || !orders[resource].acceptFeedback(reads[resource])) return;
      setContextErrors(previous => ({ ...previous, [resource]: error }));
    };
    const readOrganizations = api<{ organizations: Organization[] }>('/organizations').then(({ organizations: list }) => {
      if (!acceptData('organizations')) return;
      report('organizations');
      setOrganizationSnapshot({ list, readVersion: reads.organizations, needsRefresh: false });
      setOrganizationId(selected => selected ?? list[0]?.id ?? null);
    }).catch(reason => { report('organizations', reason); });
    const readSettings = api<Settings>('/me/settings').then(preferences => {
      if (!acceptData('settings')) return;
      report('settings');
      // A local write supersedes that field in settings reads already in flight.
      const changes = Object.fromEntries(Object.entries(preferences).filter(([key]) => {
        const field = key as keyof Settings;
        return settingsVersions.current[field] === settingsReadVersions[field];
      }));
      setSettings(previous => ({ ...previous, ...changes })); setSettingsReady(true);
    }).catch(reason => { report('settings', reason); });
    await Promise.all([readOrganizations, readSettings]);
  }, [api]);

  const accept = useCallback(async (next: User) => {
    const previous = ownerRef.current;
    const accountChanged = previous?.id !== next.id;
    if (accountChanged) {
      setSettingsReady(false); setOrganizationSnapshot(null); setOrganizationId(null);
      setContextErrors({});
    }
    epoch.current++; expectUser(next.id);
    setUser(next); setOwner(next); ownerRef.current = next; setPanel(null); setMessage('');
    if (previous && previous.id !== next.id) {
      workspaceState.clear(); setSettings(createDefaultSettings());
      navigateApproved({ kind: 'entry' }, true);
    }
    // Accepting ownership completes the transition. Reads must not delay the
    // caller's disposition of the old workspace draft.
    void loadContext();
  }, [loadContext, expectUser, workspaceState.clear, navigateApproved]);

  const observe = useCallback(async () => {
    if (transitionRef.current) return;
    const version = epoch.current;
    const readVersion = ++latestSessionRead.current;
    try {
      const result = await session();
      if (version !== epoch.current) return;
      setContextErrors(previous => ({ ...previous, session: undefined }));
      setInitializing(false);
      if (!result.user) {
        setUser(null);
      } else if (ownerRef.current && ownerRef.current.id !== result.user.id) {
        setUser(null); setPanel(null);
        const next = result.user;
        setTransition({ label: msg("app.switchToAccountValue", { v0: next.username }), action: () => accept(next) });
      } else if (ownerRef.current) {
        setUser(result.user); setOwner(result.user);
        await loadContext();
      } else {
        await accept(result.user);
      }
    } catch (reason) {
      // Focus and visibility events can overlap. A newer observation owns the result.
      if (version === epoch.current && readVersion === latestSessionRead.current && !(reason instanceof ApiError && reason.code === 'request_superseded')) {
        setInitializing(false);
        setContextErrors(previous => ({ ...previous, session: reason as Error }));
      }
    }
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
    if (!user || !organizationSnapshot) return;
    const { list, needsRefresh } = organizationSnapshot;
    if (route.kind === 'entry') {
      if (!list.some(org => org.id === selectedOrganizationId)) setOrganizationId(list[0]?.id ?? null);
    } else if (route.kind === 'projects' && route.organizationId === undefined) {
      // Membership changes invalidate the cached list for automatic navigation.
      if (needsRefresh) return;
      const id = list.some(org => org.id === selectedOrganizationId) ? selectedOrganizationId : list[0]?.id;
      const target: Route = { kind: 'projects', ...(id ? { organizationId: id } : {}) };
      if (routePath(route) !== routePath(target)) navigateApproved(target, true);
    } else if (route.kind !== 'not-found' && window.location.pathname !== routePath(route)) {
      navigateApproved(route, true);
    }
  }, [route, user, organizationSnapshot, selectedOrganizationId, navigateApproved]);

  function requestTransition(label: MessageValue, action: TransitionAction, options: {
    always?: boolean; afterSuccess?: Transition['afterSuccess'];
  } = {}) {
    if (transitionRef.current) return;
    setPanel(null); setMessage('');
    const next = { label, action, afterSuccess: options.afterSuccess };
    if (options.always || workbench.current?.hasContent()) {
      transitionRef.current = next; setTransition(next);
    } else void execute(next);
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
    if (replaceWorkspace) requestTransition(changesOrganization ? msg("app.switchOrganization") : next.kind === 'local' ? msg("app.openLocalWorkspace") : msg("app.openAnotherProject"), action);
    else void action();
  }
  async function execute({ action, afterSuccess }: Transition, discard = false) {
    const discardDraft = discard ? workbench.current?.discardDraft : undefined;
    let discardFailed = false;
    let completed = false;
    setBusy(true); setMessage('');
    try {
      const replaced = await action();
      transitionRef.current = null; setTransition(null);
      if (replaced !== false) {
        try { await discardDraft?.(); }
        catch (reason) {
          discardFailed = true;
          setMessage(reason as Error);
        }
        completed = true;
      }
    }
    catch (reason) {
      // Keep the warning about a retained local copy if the refresh also fails.
      if (!discardFailed) setMessage(reason as Error);
    }
    finally { setBusy(false); }
    // The action and draft disposition own busy. Background context refreshes
    // must not keep the next page disabled while personal settings are slow.
    if (completed) {
      try { await afterSuccess?.(); }
      catch (reason) { if (!discardFailed) setMessage(reason as Error); }
    }
  }
  async function exportDraft() {
    setBusy(true); setMessage('');
    try { await workbench.current?.exportDraft(); setMessage(msg("app.downloadRequestedCheckTheFileBeforeDiscardingOr")); }
    catch (reason) { setMessage(reason as Error); }
    finally { setBusy(false); }
  }
  function onLogin(next: User) {
    epoch.current++;
    if (owner && owner.id !== next.id) {
      setUser(null); setPanel(null);
      requestTransition(msg("app.switchToAccountValue", { v0: next.username }), () => accept(next), { always: true });
    } else void accept(next);
  }
  async function exit() {
    await api('/auth/logout', 'POST', {});
    epoch.current++;
    setUser(null); setOwner(null); ownerRef.current = null; expectUser(null);
    workspaceState.clear(); navigateApproved({ kind: 'entry' }, true);
    setSettings(createDefaultSettings()); setSettingsReady(false); setOrganizationSnapshot(null); setOrganizationId(null); setPanel(null);
    setContextErrors({});
  }
  function dismissHandbook() {
    if (!user || handbookDismissedFor === user.id) return;
    const id = user.id, version = epoch.current;
    setHandbookDismissedFor(id);
    // Dismissing a welcome prompt must not depend on server availability.
    void api('/me/handbook', 'POST', {}).then(() => {
      if (epoch.current === version && ownerRef.current?.id === id) acceptSavedSettings({ handbook_seen: true });
    }).catch(() => {
      if (epoch.current === version && ownerRef.current?.id === id) setMessage(msg("app.couldNotRememberTheHandbookPromptItMay"));
    });
  }
  const listRoute: Route = { kind: 'projects', organizationId: workspace?.project?.organization_id ?? organizationId ?? undefined };
  const feedbackMessage = [message, ...Object.values(contextErrors).map(error => formatMessage(error))].filter(Boolean).join(' ');
  const feedback = feedbackMessage && !transition && <HeaderNotice role="alert">{feedbackMessage}<button onClick={() => void observe()}>{t("app.refreshSessionAndSettings")}</button></HeaderNotice>;
  const header = <div className="account-toolbar">
    {owner && !user && <HeaderNotice>{t("app.yourSessionExpiredOrTheAccountChangedSubtitles")}</HeaderNotice>}
    {owner && user && organizations?.length === 0 && <HeaderNotice>{t("app.noOrganizationsAskADevOrOrganizerTo")}</HeaderNotice>}
    {feedback}
    {isList && <><label className="sr-only" htmlFor="organization">{t("app.currentOrganization")}</label>
    <select id="organization" disabled={!user || !organizationsReady || busy} value={organizationId ?? ''} onChange={event => {
      navigate({ kind: 'projects', organizationId: Number(event.target.value) });
    }}>
      {!organization && <option value={organizationId ?? ''}>{organizationId ? t("app.previousOrganizationIsNoLongerAccessible") : t("app.noOrganizations")}</option>}
      {organizations?.map(org => <option key={org.id} value={org.id}>{org.name} · {roleName(org.role)}</option>)}
    </select></>}
    <RouteLink className="button-link" route={listRoute} navigate={navigate}
      aria-current={isList ? 'page' : undefined}>{t("app.projects")}</RouteLink>
    {user ? <RouteLink className="button-link" route={{ kind: 'settings', organizationId: organizationId ?? undefined }} navigate={navigate}
      aria-current={isSettings ? 'page' : undefined}>{t("app.settings")}</RouteLink>
      : <button onClick={() => { void session().then(() => setPanel('login')).catch(reason => setMessage(reason)); }}>{t("app.signInAgain")}</button>}
  </div>;
  const projectLoad = workspaceState.projectLoad;

  if (initializing) return <PageLayout className="login-shell" title={<HomeLink navigate={navigate} />}><HeaderNotice>{t("app.checkingSession")}</HeaderNotice></PageLayout>;
  return <>
    {owner ? <>
      {isList && <ProjectsPanel key={`${owner.id}:${organizationId ?? 'none'}`} organization={organization} request={api}
        localOrganizationId={organizationId ?? undefined}
        localScopeReady={organizationId !== null || Boolean(organizationSnapshot?.list.length === 0 && !organizationSnapshot.needsRefresh)}
        header={header} enabled={Boolean(user && organizationsReady && !busy)} refreshVersion={organizationSnapshot?.readVersion ?? 0} navigate={navigate}
        unavailableOrganization={organizationsReady && organizationId !== null && !organization}
        onCreate={open => requestTransition(msg("app.newProject"), async () => { workspaceState.clear(); open(); })}
        onCreated={(project, video) => {
          workspaceState.adoptCreated(project, video);
          navigateApproved({ kind: 'project', organizationId: project.organization_id, projectId: project.id });
        }} onLifecycle={workspaceState.updateSummary} />}
      {route.kind === 'handbook' && <HandbookPage header={header} navigate={navigate} />}
      {route.kind === 'project-settings' && <ProjectSettingsPage key={`${owner.id}:${route.organizationId}:${route.projectId}`}
        organization={organization} organizationId={route.organizationId} projectId={route.projectId}
        request={api} header={header} enabled={Boolean(user && organizationsReady && !busy && !transition)} navigate={navigate} />}
      {isSettings && <SettingsPage user={user ?? owner} organization={organization}
        organizationGlossary={organization && <OrganizationGlossary key={`glossary:${owner.id}:${organization.id}`} request={api} organizationId={organization.id}
          enabled={Boolean(user && !busy && !transition && route.kind === 'organization-settings')} />}
        organizationStyles={organization && <OrganizationStyleLibrary key={`${owner.id}:${organization.id}`} request={api} organizationId={organization.id}
          canManage={organization.can_manage} enabled={Boolean(user && !busy && !transition)} />}
        section={route.kind === 'organization-settings' ? 'organization' : 'personal'} header={header}
        enabled={Boolean(user && !busy && !transition)} ready={route.kind === 'organization-settings' ? organizationsReady : settingsReady}
        request={api} settings={settings} language={language} navigate={navigate} onSettings={acceptSavedSettings}
        onExit={() => requestTransition(msg("app.signOut"), exit)}
        onRetry={() => void loadContext()}
        onChanged={() => void loadContext()}
        onLeave={() => {
          if (!organization) return;
          requestTransition(msg("app.leaveThisOrganization"), async () => {
            await api(`/organizations/${organization.id}/leave`, 'POST', {});
            epoch.current++;
            setOrganizationSnapshot(snapshot => snapshot && {
              ...snapshot, needsRefresh: true,
              list: user?.is_dev
                ? snapshot.list.map(value => value.id === organization.id ? { ...value, role: null, can_manage: true } : value)
                : snapshot.list.filter(value => value.id !== organization.id),
            });
            setOrganizationId(null); workspaceState.clear(); navigateApproved({ kind: 'projects' }, true);
          }, { always: true, afterSuccess: loadContext });
        }} />}
      {(route.kind === 'not-found' || route.kind === 'project' && projectLoad?.status !== 'ready') &&
        <RouteStatus header={header} loading={route.kind === 'project' && projectLoad?.status === 'loading'}
          notFound={route.kind === 'not-found'} error={projectLoad?.error} organizationId={routeOrganization(route)} navigate={navigate}
          retry={route.kind === 'project' ? workspaceState.retry : undefined} exportDraft={workspace ? () => void exportDraft() : undefined} />}
      {workspace && <div hidden={!visible}><EditorWorkbench key={workspace.generation} ref={workbench} header={visible ? header : null} title={<HomeLink navigate={navigate} />}
        diagnosticOwner={owner.id} mediaOwnerId={user && !workspaceState.accessDenied ? user.id : undefined} visible={visible} project={workspace.project} initialMedia={workspace.initialMedia}
        draftScope={draftScope(owner.id, workspace.project?.organization_id ?? workspace.localOrganizationId, workspace.project?.id)}
        onCheckDraftRevision={workspace.project ? workspaceState.checkDraftRevision : undefined}
        readOnly={Boolean(workspace.project && (workspace.project.status === 'archived' || !user || workspaceState.accessDenied))}
        onSave={workspace.project ? workspaceState.save : undefined}
        onSplit={workspace.project ? workspaceState.split : undefined}
        styleRequest={user ? api : undefined} styleOrganizationId={organization?.id} canManageTemplates={organization?.can_manage}
        onReload={workspace.project ? () => requestTransition(msg("app.reloadProject"), workspaceState.reload) : undefined}
        mouseSetsCueBoundary={settings.mouse_sets_cue_boundary} audioMode={settings.audio_display_mode} shortcutOverrides={settings.shortcut_overrides} shortcutsPaused={Boolean(!visible || panel || transition || handbookPromptOpen || !user)} /></div>}
    </> : <PageLayout className="login-shell" title={<HomeLink navigate={navigate} />}>
      {feedback}<div className="login-page"><p>{t("app.internalAccountsAreCreatedByTheSiteAdministrator")}</p>
        <LoginForm api={accountApi} onLogin={onLogin} feedbackInHeader /></div>
    </PageLayout>}
    {handbookPromptOpen && user && <HandbookPrompt key={user.id} organizationId={organizationId ?? undefined} navigate={navigate} onDismiss={dismissHandbook} />}
    {owner && panel === 'login' && <Modal title={t("app.signInAgain")} onClose={() => setPanel(null)}>
      <LoginForm api={accountApi} onLogin={onLogin} expectedUsername={owner.username} />
    </Modal>}
    {transition && <Modal title={formatMessage(transition.label)}>
      <p>{t("app.continuingDiscardsLocalSubtitlesUnappliedTimeInputsAnd")}</p>
      <p>{t("app.exportingKeepsThisDialogOpenCheckTheDownload")}</p>
      <div className="controls">
        <button disabled={busy} onClick={() => void exportDraft()}>{t("app.exportAss")}</button>
        <button disabled={busy} onClick={() => { transitionRef.current = null; setTransition(null); setMessage(''); if (!user) setPanel('login'); }}>{t("app.cancel")}</button>
        <button disabled={busy} onClick={() => void execute(transition, true)}>{t("app.discardAndContinue")}</button>
      </div>
      {message && <p role="status">{message}</p>}
    </Modal>}
  </>;
}
