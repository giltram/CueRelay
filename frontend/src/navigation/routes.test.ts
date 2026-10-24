import { describe, expect, it } from 'vitest';
import { parseRoute, routeOrganization, routePath, type Route } from './routes';

describe('resource routes', () => {
  it.each<Route>([
    { kind: 'entry' }, { kind: 'projects' }, { kind: 'projects', organizationId: 12 },
    { kind: 'project', organizationId: 12, projectId: 34 }, { kind: 'local' },
    { kind: 'project-settings', organizationId: 12, projectId: 34 },
    { kind: 'settings' }, { kind: 'organization-settings', organizationId: 12 },
    { kind: 'settings', organizationId: 12 }, { kind: 'local', organizationId: 12 },
  ])('round-trips $kind without reading application state', route => {
    expect(parseRoute(routePath(route))).toEqual(route);
  });
  it.each(['/organizations/0/projects', '/organizations/-1/projects', '/organizations/1e2/projects',
    '/organizations/01/projects', '/organizations/9007199254740992/projects', '/organizations/1/projects/no/workspace',
    '/organizations/1/projects/2', '/api/organizations/1/projects', '/admin/', '/workspace/other',
    '/organizations/0/settings', '/organizations/01/settings', '/organizations/9007199254740992/settings',
    '/organizations/0/settings/organization', '/organizations/01/settings/organization',
    '/organizations/9007199254740992/settings/organization', '/organizations/12/settings/other',
    '/organizations/0/projects/new', '/organizations/01/settings/personal', '/organizations/0/workspace/local',
    '/organizations/0/projects/2/settings', '/organizations/1/projects/0/settings',
    '/organizations/1/projects/9007199254740992/settings', '/organizations/1/projects/no/settings'])('rejects %s', path => {
    expect(parseRoute(path).kind).toBe('not-found');
  });
  it('normalizes trailing slashes while retaining explicit organization identity', () => {
    const route = parseRoute('/organizations/72/projects/5/workspace/');
    expect(routeOrganization(route)).toBe(72);
    expect(routePath(route)).toBe('/organizations/72/projects/5/workspace');
    const settings = parseRoute('/organizations/72/settings/organization/');
    expect(routeOrganization(settings)).toBe(72);
    expect(routePath(settings)).toBe('/organizations/72/settings/organization');
  });
  it('uses explicit settings sections for both organization and personal links', () => {
    expect(routePath({ kind: 'organization-settings', organizationId: 72 })).toBe('/organizations/72/settings/organization');
    expect(routePath({ kind: 'settings', organizationId: 72 })).toBe('/organizations/72/settings/personal');
  });
  it('keeps project settings independent from the workspace and retains its organization', () => {
    const route = parseRoute('/organizations/72/projects/5/settings/');
    expect(route).toEqual({ kind: 'project-settings', organizationId: 72, projectId: 5 });
    expect(routeOrganization(route)).toBe(72);
    expect(routePath(route)).toBe('/organizations/72/projects/5/settings');
  });
  it.each(['/organizations/72/settings', '/organizations/72/settings/'])('normalizes legacy organization settings link %s', path => {
    const route = parseRoute(path);
    expect(route).toEqual({ kind: 'organization-settings', organizationId: 72 });
    expect(routePath(route)).toBe('/organizations/72/settings/organization');
  });
  it('normalizes retired creation links to their organization list', () => {
    const route = parseRoute('/organizations/72/projects/new');
    expect(route).toEqual({ kind: 'projects', organizationId: 72 });
    expect(routePath(route)).toBe('/organizations/72/projects');
  });
});
