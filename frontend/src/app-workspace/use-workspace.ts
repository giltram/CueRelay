import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonRequest } from '../contracts/http';
import type { ProjectDetail, ProjectSummary } from '../contracts/projects';
import type { AssDocument, SplitRequest } from '../contracts/subtitles';
import { projectApi } from '../project-data/projects-api';
import type { Route } from '../navigation/routes';

interface Workspace { project?: ProjectDetail; initialMedia?: { file: File; sha256: string }; generation: number }
interface LoadState { key: string; status: 'loading' | 'ready' | 'error'; error?: Error }
const projectKey = (organizationId: number, projectId: number) => `${organizationId}:${projectId}`;
const matches = (workspace: Workspace | null, organizationId: number, projectId: number) =>
  workspace?.project?.organization_id === organizationId && workspace.project.id === projectId;

/** Owns a single mounted workspace, never the editor's document or timing draft. */
export function useWorkspace(route: Route, request: JsonRequest, enabled: boolean, actorId: number | undefined, onIssue: (message: string) => void) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [load, setLoad] = useState<LoadState | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const generation = useRef(0);
  const sequence = useRef(0);
  const created = useRef<string | null>(null);
  const issue = useRef(onIssue); issue.current = onIssue;
  const clear = useCallback(() => {
    sequence.current++; created.current = null;
    setWorkspace(null); setLoad(null); setAccessDenied(false);
  }, []);
  const adoptCreated = useCallback((project: ProjectDetail, file?: File) => {
    sequence.current++; created.current = projectKey(project.organization_id, project.id);
    setWorkspace({ project, generation: ++generation.current, ...(file ? { initialMedia: { file, sha256: project.media.sha256 } } : {}) });
    setLoad({ key: created.current, status: 'ready' }); setAccessDenied(false);
  }, []);
  const organizationId = route.kind === 'project' ? route.organizationId : undefined;
  const projectId = route.kind === 'project' ? route.projectId : undefined;
  const kind = route.kind;
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const version = ++sequence.current;
    if (!enabled) return;
    if (kind === 'local') {
      setWorkspace(value => value && !value.project ? value : { generation: ++generation.current });
      setLoad(null); setAccessDenied(false);
      return;
    }
    if (organizationId === undefined || projectId === undefined) return;
    const key = projectKey(organizationId, projectId);
    if (created.current === key) { created.current = null; return; }
    setLoad({ key, status: 'loading' });
    void projectApi(request, organizationId).get(projectId).then(detail => {
      if (version !== sequence.current) return;
      // Re-entering the retained workspace may only observe archive status.
      // Adopting a remote document or revision would bypass conflict protection.
      setWorkspace(value => matches(value, organizationId, projectId)
        ? { ...value!, project: { ...value!.project!, status: detail.status } }
        : { project: detail, generation: ++generation.current });
      setLoad({ key, status: 'ready' }); setAccessDenied(false);
    }).catch(error => { if (version === sequence.current) setLoad({ key, status: 'error', error }); });
    return () => { sequence.current++; };
  }, [kind, organizationId, projectId, request, enabled, actorId, retry]);

  const updateSummary = useCallback((summary: ProjectSummary) => {
    setWorkspace(value => matches(value, summary.organization_id, summary.id) ? { ...value!, project: { ...value!.project!, ...summary } } : value);
  }, []);
  const save = useCallback(async (document: AssDocument, revision: number) => {
    const project = workspace?.project;
    if (!project) throw new Error('尚未打开项目。');
    try {
      const summary = await projectApi(request, project.organization_id).save({ ...project, revision }, document);
      updateSummary(summary); return summary;
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
    if (!project) throw new Error('尚未打开项目。');
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

  const reload = useCallback(async () => {
    const project = workspace?.project;
    if (!project) return;
    const version = ++sequence.current;
    const detail = await projectApi(request, project.organization_id).get(project.id);
    if (version !== sequence.current) return;
    setWorkspace({ project: detail, generation: ++generation.current });
    setLoad({ key: projectKey(detail.organization_id, detail.id), status: 'ready' }); setAccessDenied(false);
  }, [workspace?.project, request]);


  useEffect(() => {
    const project = workspace?.project;
    if (!project || !enabled) return;
    let active = true;
    const check = () => {
      void projectApi(request, project.organization_id).get(project.id).then(latest => {
        if (!active) return;
        setWorkspace(value => matches(value, latest.organization_id, latest.id)
          ? { ...value!, project: { ...value!.project!, status: latest.status } } : value);
        setAccessDenied(false);
      }).catch(reason => {
        if (!active) return;
        if (['permission_denied', 'not_found'].includes(reason.code)) setAccessDenied(true);
        issue.current(reason.message);
      });
    };
    const timer = window.setInterval(check, 30000);
    window.addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [workspace?.project?.organization_id, workspace?.project?.id, request, enabled]);

  const projectLoad = organizationId !== undefined && projectId !== undefined
    ? load?.key === projectKey(organizationId, projectId) ? load : { key: '', status: 'loading' as const }
    : null;
  const visible = Boolean(workspace && (kind === 'local' && !workspace.project ||
    organizationId !== undefined && projectId !== undefined && matches(workspace, organizationId, projectId) && projectLoad?.status === 'ready'));
  return { workspace, visible, projectLoad, accessDenied, clear, adoptCreated, updateSummary, save, split, reload, retry: () => setRetry(value => value + 1) };
}
