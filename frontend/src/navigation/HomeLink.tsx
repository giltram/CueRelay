import { RouteLink } from './RouteLink';
import type { Route } from './routes';

export function HomeLink({ navigate }: { navigate: (route: Route) => void }) {
  return <RouteLink className="brand-link" route={{ kind: 'entry' }} target="_self" navigate={navigate}>CueRelay</RouteLink>;
}
