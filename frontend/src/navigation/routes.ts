export type Route =
  | { kind: 'entry' }
  | { kind: 'projects'; organizationId?: number }
  | { kind: 'project'; organizationId: number; projectId: number }
  | { kind: 'local' }
  | { kind: 'not-found'; path: string };

const validId = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

/** Resource paths are owned here, independently of React and API endpoints. */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { kind: 'entry' };
  if (path === '/projects') return { kind: 'projects' };
  if (path === '/workspace/local') return { kind: 'local' };
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
    case 'local': return '/workspace/local';
    case 'not-found': return route.path;
  }
}

export function routeOrganization(route: Route): number | undefined {
  return route.kind === 'project' || route.kind === 'projects' ? route.organizationId : undefined;
}
