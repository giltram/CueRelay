export type Route =
  | { kind: 'entry' }
  | { kind: 'projects'; organizationId?: number }
  | { kind: 'project'; organizationId: number; projectId: number }
  | { kind: 'local'; organizationId?: number }
  | { kind: 'settings'; organizationId?: number }
  | { kind: 'organization-settings'; organizationId: number }
  | { kind: 'not-found'; path: string };

const validId = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

/** Resource paths are owned here, independently of React and API endpoints. */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { kind: 'entry' };
  if (path === '/projects') return { kind: 'projects' };
  if (path === '/workspace/local') return { kind: 'local' };
  if (path === '/settings') return { kind: 'settings' };
  const contextual = /^\/organizations\/([^/]+)\/(workspace\/local|settings\/personal|projects\/new)$/.exec(path);
  if (contextual && validId(contextual[1])) {
    const organizationId = Number(contextual[1]);
    // Retired creation URLs normalize to the list; creation is now a local modal.
    return { kind: contextual[2] === 'workspace/local' ? 'local' : contextual[2] === 'settings/personal' ? 'settings' : 'projects', organizationId };
  }
  // Keep the original organization settings URL as a canonicalized alias.
  const settingsMatch = /^\/organizations\/([^/]+)\/settings(?:\/organization)?$/.exec(path);
  if (settingsMatch && validId(settingsMatch[1])) return { kind: 'organization-settings', organizationId: Number(settingsMatch[1]) };
  const match = /^\/organizations\/([^/]+)\/projects(?:\/([^/]+)\/workspace)?$/.exec(path);
  if (match && validId(match[1]) && (!match[2] || validId(match[2]))) {
    const organizationId = Number(match[1]);
    return match[2] ? { kind: 'project', organizationId, projectId: Number(match[2]) } : { kind: 'projects', organizationId };
  }
  return { kind: 'not-found', path: pathname };
}

export function routePath(route: Route): string {
  switch (route.kind) {
    case 'entry': return '/';
    case 'projects': return route.organizationId === undefined ? '/projects' : `/organizations/${route.organizationId}/projects`;
    case 'project': return `/organizations/${route.organizationId}/projects/${route.projectId}/workspace`;
    case 'local': return route.organizationId === undefined ? '/workspace/local' : `/organizations/${route.organizationId}/workspace/local`;
    case 'settings': return route.organizationId === undefined ? '/settings' : `/organizations/${route.organizationId}/settings/personal`;
    case 'organization-settings': return `/organizations/${route.organizationId}/settings/organization`;
    case 'not-found': return route.path;
  }
}

export function routeOrganization(route: Route): number | undefined {
  return route.kind === 'entry' || route.kind === 'not-found' ? undefined : route.organizationId;
}
