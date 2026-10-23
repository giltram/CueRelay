import { parseRoute, routePath, type Route } from './routes';

interface Position { group: string; index: number }
interface Entry { position: Position; path: string }
export type NavigationRequest = (route: Route, commit: () => void) => void;

function position(state: unknown): Position | undefined {
  const value = (state as { cueRelayNavigation?: Position } | null)?.cueRelayNavigation;
  return value && typeof value.group === 'string' && Number.isInteger(value.index) ? value : undefined;
}

/** One controller per document. History state contains only traversal metadata. */
export class HistoryNavigation {
  private current: Entry;
  private restoring: Entry | null = null;
  private replaying: Entry | null = null;
  private stopped = false;

  constructor(private browser: Window, private request: NavigationRequest, private changed: (route: Route) => void) {
    const path = browser.location.pathname + browser.location.search + browser.location.hash;
    this.current = { path, position: position(browser.history.state) ?? { group: browser.crypto.randomUUID(), index: 0 } };
    this.write(this.current, true);
    browser.addEventListener('popstate', this.onPop);
  }

  private write(entry: Entry, replace: boolean) {
    const state = { cueRelayNavigation: entry.position };
    if (replace) this.browser.history.replaceState(state, '', entry.path);
    else this.browser.history.pushState(state, '', entry.path);
  }

  navigate(route: Route, replace = false) {
    if (this.restoring || this.replaying || this.stopped) return;
    const from = this.current;
    const commit = () => {
      if (this.stopped || this.current !== from || this.restoring || this.replaying) return;
      const path = routePath(route);
      const same = from.path === path;
      this.current = { path, position: { ...from.position, index: from.position.index + (replace || same ? 0 : 1) } };
      this.write(this.current, replace || same);
      this.changed(route);
    };
    this.request(route, commit);
  }

  private onPop = (event: PopStateEvent) => {
    const next = position(event.state);
    if (!next || next.group !== this.current.position.group) {
      // Entries outside this document's managed history use normal page loading.
      this.browser.location.reload();
      return;
    }
    const target = { position: next, path: this.browser.location.pathname + this.browser.location.search + this.browser.location.hash };
    if (this.replaying && next.index === this.replaying.position.index) {
      this.current = target; this.replaying = null;
      this.changed(parseRoute(this.browser.location.pathname));
      return;
    }
    if (this.restoring && next.index === this.current.position.index) {
      const destination = this.restoring; this.restoring = null;
      const from = this.current;
      this.request(parseRoute(new URL(destination.path, this.browser.location.origin).pathname), () => {
        if (this.stopped || this.current !== from || this.restoring || this.replaying) return;
        this.replaying = destination;
        this.browser.history.go(destination.position.index - from.position.index);
      });
      return;
    }
    if (next.index === this.current.position.index) return;
    // popstate cannot be cancelled. Restore first so the guard never leaves a
    // target URL paired with the previous editor. Repeated traversal is folded.
    this.restoring = target;
    this.browser.history.go(this.current.position.index - next.index);
  };

  dispose() { this.stopped = true; this.browser.removeEventListener('popstate', this.onPop); }
}
