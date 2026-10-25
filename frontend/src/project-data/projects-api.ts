import type { JsonRequest } from '../contracts/http';
import type { ProjectDetail, ProjectSummary, ProjectPage, MediaManifest } from '../contracts/projects';
import type { AssDocument, SplitRequest, SplitResult, StyleResult } from '../contracts/subtitles';
import type { ImportStyle, ScriptSettings, StyleOperation } from '../contracts/styles';
import { documentV2 } from './document-version';

function checkedProject(project: ProjectDetail) {
  documentV2(project.document);
  return project;
}

export function projectApi(request: JsonRequest, organizationId: number) {
  const base = `/organizations/${organizationId}/projects`;
  return {
    list: (status: 'active' | 'archived', search: string, page: number) => request<ProjectPage>(`${base}?${new URLSearchParams({ status, search, page: String(page) })}`),
    get: async (id: number) => checkedProject((await request<{ project: ProjectDetail }>(`${base}/${id}`)).project),
    create: async (data: { name: string; description: string; media: MediaManifest; source: string | null; style_imports?: ImportStyle[]; script?: ScriptSettings }) =>
      checkedProject((await request<{ project: ProjectDetail }>(base, 'POST', data)).project),
    update: async (project: ProjectSummary, name: string, description: string) =>
      (await request<{ project: ProjectDetail }>(`${base}/${project.id}`, 'PATCH', { name, description, revision: project.revision })).project,
    archive: async (project: ProjectSummary, archived: boolean) =>
      (await request<{ project: ProjectSummary }>(`${base}/${project.id}/${archived ? 'archive' : 'restore'}`, 'POST', { revision: project.revision })).project,
    split: (project: ProjectSummary, split: SplitRequest) =>
      request<SplitResult & { project: ProjectSummary }>(`${base}/${project.id}/split`, 'POST', { ...split, revision: project.revision }),
    styles: (project: ProjectSummary, document: AssDocument, operation: StyleOperation) =>
      request<StyleResult & { project: ProjectSummary }>(`${base}/${project.id}/styles`, 'POST', { document, operation, revision: project.revision }),
    save: async (project: ProjectSummary, document: AssDocument) =>
      (await request<{ project: ProjectSummary }>(`${base}/${project.id}/document`, 'PUT', { revision: project.revision, document })).project,
  };
}
