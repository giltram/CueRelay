import { describe, expect, it, vi } from 'vitest';
import type { MouseEvent } from 'react';
import { RouteLink } from './RouteLink';
import { HomeLink } from './HomeLink';

function click(target: string, modified = false) {
  return { button: 0, defaultPrevented: false, metaKey: modified, ctrlKey: false, shiftKey: false, altKey: false,
    currentTarget: { target, hasAttribute: () => false }, preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement>;
}

describe('navigation tab policy', () => {
  it('leaves ordinary new-tab links to the browser with an isolated opener', () => {
    const navigate = vi.fn();
    const link = RouteLink({ route: { kind: 'settings', organizationId: 7 }, navigate });
    expect(link.props).toMatchObject({ href: '/organizations/7/settings/personal', target: '_blank', rel: 'noopener noreferrer' });
    const event = click('_blank'); link.props.onClick(event);
    expect(event.preventDefault).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it('keeps explicit current-tab exceptions guarded while preserving modifier clicks', () => {
    const navigate = vi.fn();
    const route = { kind: 'projects' as const, organizationId: 7 };
    const link = RouteLink({ route, navigate, target: '_self' });
    const event = click('_self'); link.props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledWith(route);
    navigate.mockClear();
    const modified = click('_self', true); link.props.onClick(modified);
    expect(modified.preventDefault).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
    expect(HomeLink({ navigate }).props.target).toBe('_self');
  });
});
