import type { ProjectSummary } from '../contracts/projects';
import { routeOrganization, routePath, type Route } from '../navigation/routes';

/** App decides when to ask; workspace loading and History API stay independent. */
export function workspaceNavigation(
  current: Route, next: Route, organizationId: number | null,
  workspace: { project?: Pick<ProjectSummary, 'id' | 'organization_id'> } | null,
) {
  const nextOrganization = routeOrganization(next);
  const changesOrganization = nextOrganization !== undefined && nextOrganization !== organizationId;
  const changesWorkspace = next.kind === 'project'
    ? workspace?.project?.id !== next.projectId || workspace.project.organization_id !== next.organizationId
    : next.kind === 'local' && Boolean(workspace?.project);
  return {
    changesOrganization,
    replacesWorkspace: changesOrganization || changesWorkspace,
    leavesWorkspace: (current.kind === 'project' || current.kind === 'local') && routePath(current) !== routePath(next),
  };
}
