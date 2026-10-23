import { describe, expect, it } from 'vitest';
import { HistoryNavigation, type NavigationRequest } from './history-navigation';
import { routePath, type Route } from './routes';

/** Models asynchronous traversal rather than treating history.go as synchronous. */
function browserHistory() {
  const entries = [{ path: '/organizations/1/projects', state: null as unknown }];
  let index = 0;
  let listener: (event: PopStateEvent) => void = () => {};
  const browser = {
    crypto: { randomUUID: () => 'test-document' },
    location: { origin: 'http://localhost', pathname: entries[0].path, search: '', hash: '', reload: () => { throw new Error('unexpected document navigation'); } },
    addEventListener: (_: string, callback: typeof listener) => { listener = callback; },
    removeEventListener: () => { listener = () => {}; },
    history: {
      get state() { return entries[index].state; },
      replaceState(state: unknown, _: string, path: string) { entries[index] = { state, path }; browser.location.pathname = path; },
      pushState(state: unknown, _: string, path: string) { entries.splice(index + 1); entries.push({ state, path }); index++; browser.location.pathname = path; },
      go(delta: number) {
        const destination = index + delta;
        if (destination < 0 || destination >= entries.length) return;
        queueMicrotask(() => {
          index = destination; browser.location.pathname = entries[index].path;
          listener({ state: entries[index].state } as PopStateEvent);
        });
      },
    },
  };
  return { browser: browser as unknown as Window, entries, get index() { return index; } };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const project: Route = { kind: 'project', organizationId: 1, projectId: 2 };

describe('guarded history traversal', () => {
  it('restores the URL before asking permission and preserves forward history on cancellation', async () => {
    const fixture = browserHistory();
    let request: NavigationRequest = (_route, commit) => commit();
    let displayed = fixture.browser.location.pathname;
    const navigation = new HistoryNavigation(fixture.browser, (route, commit) => request(route, commit), route => { displayed = routePath(route); });
    navigation.navigate(project);
    let approve: (() => void) | undefined;
    request = (_route, commit) => {
      expect(fixture.browser.location.pathname).toBe(displayed);
      approve = commit;
    };
    fixture.browser.history.go(-1); await settle();
    expect(fixture.index).toBe(1);
    expect(displayed).toBe(routePath(project));
    expect(fixture.entries).toHaveLength(2);
    // Cancel means never invoking the offered commit. A later traversal works.
    fixture.browser.history.go(-1); await settle();
    approve!(); await settle();
    expect(fixture.index).toBe(0);
    expect(displayed).toBe('/organizations/1/projects');
    fixture.browser.history.go(1); await settle(); approve!(); await settle();
    expect(fixture.index).toBe(1);
    expect(displayed).toBe(routePath(project));
    expect(fixture.entries).toHaveLength(2);
    navigation.dispose();
  });
  it('supports multi-entry traversal and ignores stale approval callbacks', async () => {
    const fixture = browserHistory();
    let request: NavigationRequest = (_route, commit) => commit();
    const navigation = new HistoryNavigation(fixture.browser, (route, commit) => request(route, commit), () => {});
    navigation.navigate(project); navigation.navigate({ kind: 'projects', organizationId: 1 });
    let stale = () => {};
    request = (_route, commit) => { stale = commit; };
    fixture.browser.history.go(-2); await settle();
    expect(fixture.index).toBe(2);
    request = (_route, commit) => commit();
    navigation.navigate({ kind: 'local' });
    stale(); await settle();
    expect(fixture.index).toBe(3);
    expect(fixture.browser.location.pathname).toBe('/workspace/local');
    expect(JSON.stringify(fixture.browser.history.state)).toBe('{"cueRelayNavigation":{"group":"test-document","index":3}}');
    navigation.dispose();
  });
});
