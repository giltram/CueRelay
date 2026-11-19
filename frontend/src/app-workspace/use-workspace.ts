import { type MessageValue, describe, MessageError } from '../contracts/messages';
import { diagnostics } from '../diagnostics';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonRequest } from '../contracts/http';
import type { ProjectDetail, ProjectSummary, ProjectSaveRequest } from '../contracts/projects';
import type { SplitRequest } from '../contracts/subtitles';
import { projectApi } from '../project-data/projects-api';
import { saveProjectDocument } from '../project-data/project-document-save';
import type { InitialVideo, SelectedVideo } from '../media/video-file-access';
import type { Route } from '../navigation/routes';
import { ReadOrder } from '../request-state/read-order';

interface Workspace { project?: ProjectDetail; initialMedia?: InitialVideo; localOrganizationId?: number; generation: number }
interface LoadState { key: string; status: 'loading' | 'ready' | 'error'; error?: Error }
interface StatusContext { key: string; order: ReadOrder }
interface StatusRead { context: StatusContext; version: number }
const beginStatusRead = (context: StatusContext): StatusRead => ({ context, version: context.order.start() });
const projectKey = (organizationId: number, projectId: number) => `${organizationId}:${projectId}`;
const matches = (workspace: Workspace | null, organizationId: number, projectId: number) =>
  workspace?.project?.organization_id === organizationId && workspace.project.id === projectId;

/** Owns a single mounted workspace, never the editor's document or timing draft. */
export function useWorkspace(route: Route, request: JsonRequest, enabled: boolean, actorId: number | undefined, onIssue: (message: MessageValue) => void) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [load, setLoad] = useState<LoadState | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const generation = useRef(0);
  const sequence = useRef(0);
  const created = useRef<string | null>(null);
  const statusContext = useRef<StatusContext | null>(null);
  const statusFor = useCallback((organizationId: number, projectId: number): StatusContext => {
    const key = `${actorId}:${projectKey(organizationId, projectId)}`;
    if (statusContext.current?.key !== key) statusContext.current = { key, order: new ReadOrder() };
    return statusContext.current;
  }, [actorId]);
  const acceptStatusRead = useCallback(({ context, version }: StatusRead) => {
    if (statusContext.current !== context || !context.order.acceptData(version)) return false;
    context.order.acceptFeedback(version);
    return true;
  }, []);
  const denyStatusRead = useCallback((read: StatusRead, reason: unknown) => {
    if (['permission_denied', 'not_found'].includes((reason as { code?: string }).code ?? '')
      && acceptStatusRead(read)) setAccessDenied(true);
  }, [acceptStatusRead]);
  const issue = useRef(onIssue); issue.current = onIssue;
  const clear = useCallback(() => {
    sequence.current++; created.current = null;
    statusContext.current = null;
    setWorkspace(null); setLoad(null); setAccessDenied(false);
  }, []);
  const adoptCreated = useCallback((project: ProjectDetail, video?: SelectedVideo) => {
    sequence.current++; created.current = projectKey(project.organization_id, project.id);
    statusContext.current = null;
    setWorkspace({ project, generation: ++generation.current, ...(video ? { initialMedia: { ...video, sha256: project.media.sha256 } } : {}) });
    setLoad({ key: created.current, status: 'ready' }); setAccessDenied(false);
  }, []);
  const organizationId = route.kind === 'project' ? route.organizationId : undefined;
  const projectId = route.kind === 'project' ? route.projectId : undefined;
  const localOrganizationId = route.kind === 'local' ? route.organizationId : undefined;
  const kind = route.kind;
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const version = ++sequence.current;
    if (!enabled) { statusContext.current = null; return; }
    if (kind === 'local') {
      statusContext.current = null;
      setWorkspace(value => value && !value.project ? value : { localOrganizationId, generation: ++generation.current });
      setLoad(null); setAccessDenied(false);
      return;
    }
    if (organizationId === undefined || projectId === undefined) return;
    const key = projectKey(organizationId, projectId);
    if (created.current === key) { created.current = null; return; }
    const statusRead = beginStatusRead(statusFor(organizationId, projectId));
    setLoad({ key, status: 'loading' });
    void projectApi(request, organizationId).get(projectId).then(detail => {
      if (version !== sequence.current) return;
      const acceptStatus = acceptStatusRead(statusRead);
      // Re-entering the retained workspace may only observe archive status.
      // Adopting a remote document or revision would bypass conflict protection.
      setWorkspace(value => {
        if (!matches(value, organizationId, projectId)) return { project: detail, generation: ++generation.current };
        if (!acceptStatus) return value;
        return { ...value!, project: { ...value!.project!, status: detail.status } };
      });
      setLoad({ key, status: 'ready' });
      if (acceptStatus) setAccessDenied(false);
    }).catch(error => {
      if (version !== sequence.current) return;
      if (error.code === 'request_superseded') { setRetry(value => value + 1); return; }
      denyStatusRead(statusRead, error);
      setLoad({ key, status: 'error', error });
    });
    return () => { sequence.current++; };
  }, [kind, organizationId, projectId, localOrganizationId, request, enabled, actorId, retry, statusFor, acceptStatusRead, denyStatusRead]);

  const updateSummary = useCallback((summary: ProjectSummary) => {
    setWorkspace(value => matches(value, summary.organization_id, summary.id) ? { ...value!, project: { ...value!.project!, ...summary } } : value);
  }, []);
  const save = useCallback(async (input: ProjectSaveRequest) => {
    const project = workspace?.project;
    if (!project) throw new MessageError(describe("appWorkspace.noProjectIsOpen", "尚未打开项目。"));
    try {
      const result = await saveProjectDocument(projectApi(request, project.organization_id), project, input);
      updateSummary(result.project); return result;
    } catch (reason) {
      if ((reason as { code?: string }).code === 'project_archived') {
        setWorkspace(value => matches(value, project.organization_id, project.id)
          ? { ...value!, project: { ...value!.project!, status: 'archived' } } : value);
      }
      throw reason;
    }
  }, [workspace?.project, request, updateSummary]);

  const split = useCallback(async (splitRequest: SplitRequest, revision: number) => {
    const project = workspace?.project;
    if (!project) throw new MessageError(describe("appWorkspace.noProjectIsOpen", "尚未打开项目。"));
    try {
      const result = await projectApi(request, project.organization_id).split({ ...project, revision }, splitRequest);
      updateSummary(result.project);
      return result;
    } catch (reason) {
      if ((reason as { code?: string }).code === 'project_archived') {
        setWorkspace(value => matches(value, project.organization_id, project.id)
          ? { ...value!, project: { ...value!.project!, status: 'archived' } } : value);
      }
      throw reason;
    }
  }, [workspace?.project, request, updateSummary]);

  const checkDraftRevision = useCallback(async () => {
    if (organizationId === undefined || projectId === undefined) return null;
    return (await projectApi(request, organizationId).get(projectId)).revision;
  }, [request, organizationId, projectId]);

  const reload = useCallback(async () => {
    const project = workspace?.project;
    if (!project) return;
    diagnostics.record('workspace', 'reload', 'start', { revision: project.revision });
    const version = ++sequence.current;
    const statusRead = beginStatusRead(statusFor(project.organization_id, project.id));
    let detail: ProjectDetail;
    try { detail = await projectApi(request, project.organization_id).get(project.id); }
    catch (reason) { denyStatusRead(statusRead, reason); throw reason; }
    // The caller must keep the existing draft if no replacement took place.
    if (version !== sequence.current || !acceptStatusRead(statusRead)) return false as const;
    diagnostics.record('workspace', 'reload', 'success', { revision: detail.revision });
    setWorkspace({ project: detail, generation: ++generation.current });
    setLoad({ key: projectKey(detail.organization_id, detail.id), status: 'ready' }); setAccessDenied(false);
  }, [workspace?.project, request, statusFor, acceptStatusRead, denyStatusRead]);


  useEffect(() => {
    const project = workspace?.project;
    if (!project || !enabled) return;
    let active = true;
    const context = statusFor(project.organization_id, project.id);
    const check = () => {
      if (!active || statusContext.current !== context) return;
      const statusRead = beginStatusRead(context);
      void projectApi(request, project.organization_id).get(project.id).then(latest => {
        if (!active || !acceptStatusRead(statusRead)) return;
        setWorkspace(value => matches(value, latest.organization_id, latest.id)
          ? { ...value!, project: { ...value!.project!, status: latest.status } } : value);
        setAccessDenied(false);
      }).catch(reason => {
        if (!active || reason.code === 'request_superseded' || statusContext.current !== statusRead.context) return;
        denyStatusRead(statusRead, reason);
        if (statusRead.context.order.acceptFeedback(statusRead.version)) issue.current(reason);
      });
    };
    const timer = window.setInterval(check, 30000);
    window.addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [workspace?.project?.organization_id, workspace?.project?.id, request, enabled, statusFor, acceptStatusRead, denyStatusRead]);

  const projectLoad = organizationId !== undefined && projectId !== undefined
    ? load?.key === projectKey(organizationId, projectId) ? load : { key: '', status: 'loading' as const }
    : null;
  const visible = Boolean(workspace && (kind === 'local' && !workspace.project ||
    organizationId !== undefined && projectId !== undefined && matches(workspace, organizationId, projectId) && projectLoad?.status === 'ready'));
  return { workspace, visible, projectLoad, accessDenied, clear, adoptCreated, updateSummary, save, split, reload, checkDraftRevision, retry: () => setRetry(value => value + 1) };
}
