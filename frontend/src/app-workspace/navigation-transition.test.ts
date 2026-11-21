import { describe, expect, it } from 'vitest';
import { workspaceNavigation } from './navigation-transition';
import type { Route } from '../navigation/routes';

const project: Route = { kind: 'project', organizationId: 1, projectId: 7 };
const workspace = { project: { organization_id: 1, id: 7 } };

describe('workspace navigation boundary', () => {
  it.each<Route>([
    { kind: 'entry' }, { kind: 'projects', organizationId: 1 },
    { kind: 'settings', organizationId: 1 }, { kind: 'organization-settings', organizationId: 1 },
    { kind: 'project-settings', organizationId: 1, projectId: 7 },
    { kind: 'handbook', organizationId: 1 }, { kind: 'not-found', path: '/missing' },
  ])('checks unsaved changes before leaving for $kind, even when the instance can be retained', next => {
    expect(workspaceNavigation(project, next, 1, workspace)).toEqual({
      changesOrganization: false, replacesWorkspace: false, leavesWorkspace: true,
    });
  });

  it('does not count reselecting the current route as leaving', () => {
    expect(workspaceNavigation(project, { ...project }, 1, workspace).leavesWorkspace).toBe(false);
    expect(workspaceNavigation({ kind: 'local' }, { kind: 'local' }, 1, {})).toMatchObject({
      leavesWorkspace: false, replacesWorkspace: false,
    });
  });

  it('keeps cross-project, local and organization replacements guarded', () => {
    for (const next of [
      { kind: 'project', organizationId: 1, projectId: 8 },
      { kind: 'local', organizationId: 1 },
      { kind: 'projects', organizationId: 2 },
    ] satisfies Route[]) expect(workspaceNavigation(project, next, 1, workspace)).toMatchObject({
      replacesWorkspace: true, leavesWorkspace: true,
    });
  });

  it('does not defer a workspace exit until a later list-page action', () => {
    expect(workspaceNavigation({ kind: 'local' }, { kind: 'entry' }, 1, {}).leavesWorkspace).toBe(true);
    expect(workspaceNavigation({ kind: 'entry' }, { kind: 'settings', organizationId: 1 }, 1, workspace)).toEqual({
      changesOrganization: false, replacesWorkspace: false, leavesWorkspace: false,
    });
  });
});
