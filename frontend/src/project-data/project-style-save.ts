import type { ProjectDetail } from '../contracts/projects';
import type { StyleOperation } from '../contracts/styles';
import type { projectApi } from './projects-api';
import { sameSnapshotValue } from '../subtitle-model/snapshot-equality';

type StyleApi = Pick<ReturnType<typeof projectApi>, 'get' | 'styles'>;

function canRetry(base: ProjectDetail, latest: ProjectDetail, operation: StyleOperation) {
  if (latest.status !== 'active') return false;
  // A conservative baseline: unrelated style changes also require explicit review.
  // Never send the old cue snapshot with a newly acquired revision.
  for (const key of ['source', 'styles', 'script'] as const) {
    if (!sameSnapshotValue(base.document[key], latest.document[key])) return false;
  }
  if (operation.type === 'assign') {
    const before = new Map(base.document.cues.map(cue => [cue.id, cue.style_id]));
    const after = new Map(latest.document.cues.map(cue => [cue.id, cue.style_id]));
    return operation.cue_ids.every(id => before.has(id) && after.has(id) && before.get(id) === after.get(id));
  }
  return true;
}

/** Retry one confirmed revision conflict against unchanged style definitions.
 * Network/unknown failures never retry: the first write may have committed.
 * Backend CAS, validation, permissions and usage checks still govern both writes.
 */
export async function saveProjectStyles(api: StyleApi, project: ProjectDetail, operation: StyleOperation) {
  let base = project;
  let result;
  try {
    result = await api.styles(base, base.document, operation);
  } catch (reason) {
    if ((reason as { code?: string } | null)?.code !== 'project_conflict') throw reason;
    const latest = await api.get(project.id);
    if (!canRetry(project, latest, operation)) throw reason;
    base = latest;
    result = await api.styles(base, base.document, operation);
  }
  return { ...result, project: { ...base, ...result.project, document: result.document } };
}
