import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { routePath, type Route } from './routes';

export function RouteLink({ route, navigate, onClick, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  route: Route; navigate: (route: Route) => void;
}) {
  function click(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      (event.currentTarget.target && event.currentTarget.target !== '_self') || event.currentTarget.hasAttribute('download')) return;
    event.preventDefault(); navigate(route);
  }
  return <a {...props} href={routePath(route)} onClick={click} />;
}
