import { describe, expect, it } from 'vitest';
import { parseRoute, routeOrganization, routePath, type Route } from './routes';

describe('resource routes', () => {
  it.each<Route>([
    { kind: 'entry' }, { kind: 'projects' }, { kind: 'projects', organizationId: 12 },
    { kind: 'project', organizationId: 12, projectId: 34 }, { kind: 'local' },
  ])('round-trips $kind without reading application state', route => {
    expect(parseRoute(routePath(route))).toEqual(route);
  });
  it.each(['/organizations/0/projects', '/organizations/-1/projects', '/organizations/1e2/projects',
    '/organizations/01/projects', '/organizations/9007199254740992/projects', '/organizations/1/projects/no/workspace',
    '/organizations/1/projects/2', '/api/organizations/1/projects', '/admin/', '/workspace/other'])('rejects %s', path => {
    expect(parseRoute(path).kind).toBe('not-found');
  });
  it('normalizes trailing slashes while retaining explicit organization identity', () => {
    const route = parseRoute('/organizations/72/projects/5/workspace/');
    expect(routeOrganization(route)).toBe(72);
    expect(routePath(route)).toBe('/organizations/72/projects/5/workspace');
  });
});
