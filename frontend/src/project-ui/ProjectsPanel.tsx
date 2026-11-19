import { useMessageState, useLocale } from '../i18n/react';
import { t, i18n } from "../i18n";
import { PageLayout, HeaderNotice } from '../page-ui/PageLayout';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Organization } from '../account-ui/api';
import type { JsonRequest } from '../contracts/http';
import { Modal } from '../page-ui/Modal';
import type { ProjectDetail, ProjectPage, ProjectSummary } from '../contracts/projects';
import { projectApi } from '../project-data/projects-api';
import type { SelectedVideo } from '../media/video-file-access';
import { ProjectForm } from './ProjectForm';
import { RouteLink } from '../navigation/RouteLink';
import { HomeLink } from '../navigation/HomeLink';
import type { Route } from '../navigation/routes';
import { ReadOrder } from '../request-state/read-order';

interface ListReads { order: ReadOrder; pending: number; lastPage?: number }

export function ProjectsPanel({ organization, localOrganizationId, localScopeReady, request, header, enabled, refreshVersion, navigate, onCreate, onCreated, onLifecycle, unavailableOrganization }: {
  organization: Organization | undefined; request: JsonRequest; header: ReactNode; enabled: boolean;
  localOrganizationId: number | undefined;
  localScopeReady: boolean;
  refreshVersion: number;
  navigate: (route: Route) => void; onCreate: (open: () => void) => void;
  onCreated: (project: ProjectDetail, video?: SelectedVideo) => void; onLifecycle: (project: ProjectSummary) => void;
  unavailableOrganization?: boolean;
}) {
  useLocale();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<(ProjectPage & { context: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useMessageState('');
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const activeReads = useRef<ListReads | null>(null);
  const context = `${status}:${query}:${page}`;
  const data = loaded?.context === context ? loaded : null;
  const organizationId = organization?.id;
  const api = useMemo(() => projectApi(request, organizationId ?? 0), [request, organizationId]);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  useEffect(() => {
    // A different filter/resource owns new feedback. Page correction keeps the
    // filter, so preserve its relevant error until a successful recovery.
    setError('');
  }, [api, status, query, enabled, setError]);
  useEffect(() => {
    activeReads.current = { order: new ReadOrder(), pending: 0 };
    setLoading(false);
    return () => { activeReads.current = null; };
  }, [api, status, query, page, enabled]);
  useEffect(() => {
    const reads = activeReads.current;
    if (!organizationId || !enabled) return;
    if (!reads) return;
    const { order } = reads;
    const version = order.start();
    reads.pending++;
    setLoading(true);
    void api.list(status, query, page).then(value => {
      if (activeReads.current !== reads || !order.acceptData(version)) return;
      if (order.acceptFeedback(version)) setError('');
      const lastPage = Math.max(1, Math.ceil(value.total / 25));
      reads.lastPage = lastPage;
      if (page > lastPage) {
        if (order.isLatest(version)) setPage(lastPage);
      }
      else setLoaded({ ...value, context });
    })
      .catch(reason => {
        if (activeReads.current !== reads) return;
        if (reason.code === 'request_superseded') {
          // Identity was reconfirmed after this request. Retry the same query
          // without waiting for an unrelated organization refresh to succeed.
          if (order.isLatest(version)) setRefresh(value => value + 1);
          return;
        }
        if (['permission_denied', 'not_found', 'authentication_required', 'account_changed'].includes(reason.code)
          && order.acceptData(version)) {
          reads.lastPage = undefined;
          setLoaded(null);
        }
        if (order.acceptFeedback(version)) setError(reason);
      }).finally(() => {
        reads.pending--;
        if (activeReads.current !== reads) return;
        setLoading(reads.pending > 0);
        // A newer failure supplies feedback, not a total. Once all reads settle,
        // the last accepted total is authoritative even if it came from an older read.
        if (reads.pending === 0 && reads.lastPage !== undefined && page > reads.lastPage) setPage(reads.lastPage);
      });
  }, [api, organizationId, status, query, page, refresh, refreshVersion, enabled]);
  // User navigation clears old page feedback; automatic correction uses setPage.
  function changePage(nextPage: number) {
    if (nextPage !== page) setError('');
    setPage(nextPage);
  }
  function saved(project: ProjectDetail, video?: SelectedVideo) {
    setCreating(false); setRefresh(value => value + 1);
    onCreated(project, video);
  }
  const person = (user: { username: string } | null) => user?.username || '—';
  const date = (value: string | null) => value ? new Date(value).toLocaleString(i18n.language, { hour12: false }) : '—';
  return <PageLayout className="projects-page" title={<HomeLink navigate={navigate} />} navigation={header}>
    <div className="project-heading"><h2>{t("projectUi.projects")}</h2><div className="controls">
      {localScopeReady
        ? <RouteLink className="button-link" route={{ kind: 'local', organizationId: localOrganizationId }} navigate={navigate}>{t("projectUi.localWorkspace")}</RouteLink>
        : <button disabled>{t("projectUi.localWorkspace")}</button>}
      {organization?.can_manage && <button className="primary" disabled={!enabled || busy} onClick={() => onCreate(() => setCreating(true))}>{t("projectUi.newProject")}</button>}
    </div></div>
    {organization ? <>
      <div className="project-filters">
        <div className="project-tabs" role="tablist" aria-label={t("projectUi.projectStatus")}>
          <button role="tab" aria-selected={status === 'active'} onClick={() => { setStatus('active'); changePage(1); }}>{t("projectUi.active")}</button>
          <button role="tab" aria-selected={status === 'archived'} onClick={() => { setStatus('archived'); changePage(1); }}>{t("projectUi.archived")}</button>
        </div>
        <label>{t("projectUi.searchProjects")}<input type="search" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder={t("projectUi.searchByProjectName")} /></label>
      </div>
      {loading && !data && <HeaderNotice>{t("projectUi.loadingProject")}</HeaderNotice>}
      {error && !confirm && <HeaderNotice className="header-error" role="alert">{error}<button onClick={() => setRefresh(value => value + 1)}>{t("projectUi.retry")}</button></HeaderNotice>}
      {data && <div className="project-table-scroll"><table className="project-table"><thead><tr>
        <th>{t("projectUi.projects")}</th><th>{status === 'active' ? t("projectUi.lastUpdated") : t("projectUi.archivedAt")}</th><th>{status === 'active' ? t("projectUi.updatedBy") : t("projectUi.archivedBy")}</th><th>{t("projectUi.action")}</th>
      </tr></thead><tbody>{data.projects.map(project => <tr key={project.id}>
        <td><RouteLink className="project-name" route={{ kind: 'project', organizationId: project.organization_id, projectId: project.id }} navigate={navigate}>{project.name}</RouteLink>
          {project.description && <p className="project-description">{project.description}</p>}</td>
        <td>{date(status === 'active' ? project.updated_at : project.archived_at)}</td>
        <td>{person(status === 'active' ? project.updated_by : project.archived_by)}</td>
        <td><div className="controls">
          <RouteLink className="button-link" route={{ kind: 'project-settings', organizationId: project.organization_id, projectId: project.id }} navigate={navigate}>{t("projectUi.projectSettings")}</RouteLink>
          {organization.can_manage && <>
            <button disabled={!enabled || busy} onClick={() => { setConfirm(project); setError(''); }}>{status === 'active' ? t("projectUi.archiveProject") : t("projectUi.restoreProject")}</button>
          </>}
        </div></td>
      </tr>)}</tbody></table>
        {data.projects.length === 0 && <div className="empty">
          {query ? <><p>{t("projectUi.noMatchingProjects")}</p><button onClick={() => setSearch('')}>{t("projectUi.clearSearch")}</button></> :
            <p>{status === 'archived' ? t("projectUi.noArchivedProjects") : organization.can_manage ? t("projectUi.noActiveProjectsYouCanCreateOne") : t("projectUi.thisOrganizationHasNoActiveProjects")}</p>}
        </div>}
      </div>}
      {data && <div className="project-pagination"><span>{t("projectUi.pagination", { count: data.total, page: data.page })}</span><div className="controls">
        <button disabled={page === 1} onClick={() => changePage(page - 1)}>{t("projectUi.previousPage")}</button>
        <button disabled={!data.has_more} onClick={() => changePage(page + 1)}>{t("projectUi.nextPage")}</button>
      </div></div>}
    </> : <div className="empty"><p role={unavailableOrganization ? 'alert' : undefined}>{unavailableOrganization
      ? t("projectUi.theRequestedOrganizationDoesNotExistOrIs")
      : t("projectUi.noOrganizationsAskADevOrOrganizerTo")}</p>
      {unavailableOrganization && <RouteLink target="_self" route={{ kind: 'projects' }} navigate={navigate}>{t("projectUi.chooseAnAccessibleOrganization")}</RouteLink>}
    </div>}
    {organization && creating && <ProjectForm api={api} organization={organization} request={request}
      onClose={() => setCreating(false)} onSaved={saved} />}
    {confirm && <Modal title={confirm.status === 'active' ? t("projectUi.archiveProject") : t("projectUi.restoreProject")} showCloseButton={confirm.status !== 'active'} onClose={busy ? undefined : () => setConfirm(null)}>
      <p>{confirm.status === 'active' ? t("projectUi.afterArchivingValueMembersCanOnlyViewAnd", { v0: confirm.name }) : t("projectUi.afterRestoringValueOrganizationMembersCanContinueWorking", { v0: confirm.name })}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="controls"><button disabled={busy} onClick={() => setConfirm(null)}>{t("projectUi.cancel")}</button>
        <button className="primary" disabled={busy} onClick={() => {
          setBusy(true); setError('');
          void api.archive(confirm, confirm.status === 'active').then(project => { onLifecycle(project); setConfirm(null); setRefresh(value => value + 1); })
            .catch(reason => setError(reason)).finally(() => setBusy(false));
        }}>{confirm.status === 'active' ? t("projectUi.confirmArchive") : t("projectUi.confirmRestore")}</button>
      </div>
    </Modal>}
  </PageLayout>;
}
