import { describe, MessageError } from "../contracts/messages";
import type { ProjectSaveRequest, ProjectSaveResult, ProjectSummary } from '../contracts/projects';
import { withStyleSnapshot } from '../subtitle-model/style-snapshot';
import { sameSnapshotValue } from '../subtitle-model/snapshot-equality';
import type { projectApi } from './projects-api';

type DocumentApi = Pick<ReturnType<typeof projectApi>, 'get' | 'save'>;

/** Reconcile styles only after a confirmed conflict; unknown writes never retry. */
export async function saveProjectDocument(api: DocumentApi, project: ProjectSummary, input: ProjectSaveRequest): Promise<ProjectSaveResult> {
  const { document, baseDocument, revision } = input;
  try {
    return { project: await api.save({ ...project, revision }, document), document };
  } catch (reason) {
    if ((reason as { code?: string } | null)?.code !== 'project_conflict') throw reason;
    const latest = await api.get(project.id);
    // Local style definitions are not editable in a project workspace. A stale
    // history or a changed remote cue must never be relabelled with a new CAS.
    if (latest.status !== 'active' || latest.document.source !== baseDocument.source
      || !sameSnapshotValue(latest.document.cues, baseDocument.cues)
      || (['source', 'styles', 'script'] as const).some(key => !sameSnapshotValue(document[key], baseDocument[key]))) throw reason;
    const available = new Set(latest.document.styles.map(style => style.id));
    if ([...input.requiredStyleIds, ...document.cues.map(cue => cue.style_id)].some(id => !available.has(id))) {
      throw Object.assign(new MessageError(describe("projectData.aStyleNeededByLocalEditsOrUndo", "项目中有本地编辑或撤销历史使用的样式已被删除，无法自动合并；当前输入已保留。请先导出备份并核对项目样式。")), { code: 'project_conflict' });
    }
    const merged = withStyleSnapshot(document, latest.document);
    // One retry only. A second race or lost response leaves the editor untouched.
    return { project: await api.save(latest, merged), document: merged };
  }
}
