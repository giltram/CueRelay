import { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryNavigation, type NavigationRequest } from './history-navigation';
import { parseRoute, type Route } from './routes';

export function useNavigation(request: NavigationRequest) {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  const handler = useRef(request); handler.current = request;
  const controller = useRef<HistoryNavigation | null>(null);
  useEffect(() => {
    const history = new HistoryNavigation(window, (next, commit) => handler.current(next, commit), setRoute);
    controller.current = history;
    return () => { history.dispose(); controller.current = null; };
  }, []);
  const navigate = useCallback((next: Route, replace = false) => controller.current?.navigate(next, replace), []);
  return { route, navigate };
}
