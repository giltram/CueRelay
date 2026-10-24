import type { ReactNode } from 'react';
import type { AccountRequest, Organization, Settings, User } from './api';
import { MembersPanel } from './MembersPanel';
import { PersonalPanel } from './PersonalPanel';
import { HomeLink } from '../navigation/HomeLink';
import { RouteLink } from '../navigation/RouteLink';
import type { Route } from '../navigation/routes';

/** Page layout only; App owns session, organization selection and guarded actions. */
export function SettingsPage({ user, organization, section, header, enabled, ready, request, settings, navigate,
  onSettings, onExit, onChanged, onLeave, onRetry }: {
  user: User; organization?: Organization; section: 'personal' | 'organization'; header: ReactNode;
  enabled: boolean; ready: boolean; request: AccountRequest; settings: Settings;
  navigate: (route: Route) => void; onSettings: (settings: Settings) => void;
  onExit: () => void; onChanged: () => void; onLeave: () => void; onRetry: () => void;
}) {
  return <main className="settings-page">
    <header className="app-header"><h1><HomeLink navigate={navigate} /></h1>{header}</header>
    <h2 className="settings-title">设置</h2>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        <RouteLink route={{ kind: 'settings', organizationId: organization?.id }} navigate={navigate} target="_self" aria-current={section === 'personal' ? 'page' : undefined}>个人设置</RouteLink>
        {organization
          ? <RouteLink route={{ kind: 'organization-settings', organizationId: organization.id }} navigate={navigate} target="_self"
            aria-current={section === 'organization' ? 'page' : undefined}>组织设置</RouteLink>
          : <span aria-disabled="true">组织设置</span>}
      </nav>
      <section className="settings-content" aria-label={section === 'personal' ? '个人设置' : '组织设置'}>
        <h2>{section === 'personal' ? '个人设置' : '组织设置'}</h2>
        {!ready ? <p role="status">正在加载设置…</p> : <fieldset disabled={!enabled}>
          {section === 'personal' ? <div className="account-form">
            <div className="controls"><span>{user.username}{user.is_dev ? ' · dev' : ''}</span>
              {user.is_dev && <a className="button-link" href="/admin/" target="_blank" rel="noreferrer">Django Admin</a>}
              <button onClick={onExit}>退出账号</button>
            </div>
            <PersonalPanel key={user.id} request={request} settings={settings} onSettings={onSettings} />
          </div> : organization
            ? <MembersPanel key={organization.id} currentUserId={user.id} isDev={user.is_dev} request={request}
              organization={organization} onChanged={onChanged} onLeave={onLeave} />
            : <div className="account-form"><p role="alert">组织不存在或无权访问。</p><button onClick={onRetry}>重新加载组织</button></div>}
        </fieldset>}
        {section === 'personal' && ready && !organization && <p>暂无可用组织。请联系管理员添加成员后使用组织设置。</p>}
      </section>
    </div>
  </main>;
}
