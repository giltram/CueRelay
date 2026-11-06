import { PageLayout, HeaderNotice } from '../page-ui/PageLayout';
import { ExportDiagnostics } from '../diagnostics/ExportDiagnostics';
import { useState, type ReactNode } from 'react';
import type { AccountRequest, Organization, Settings, User } from './api';
import { MembersPanel } from './MembersPanel';
import { PersonalPanel } from './PersonalPanel';
import { HomeLink } from '../navigation/HomeLink';
import { RouteLink } from '../navigation/RouteLink';
import type { Route } from '../navigation/routes';

/** Page layout only; App owns session, organization selection and guarded actions. */
export function SettingsPage({ user, organization, section, header, organizationStyles, enabled, ready, request, settings, navigate,
  onSettings, onExit, onChanged, onLeave, onRetry }: {
  user: User; organization?: Organization; section: 'personal' | 'organization'; header: ReactNode;
  enabled: boolean; ready: boolean; request: AccountRequest; settings: Settings;
  organizationStyles?: ReactNode;
  navigate: (route: Route) => void; onSettings: (settings: Settings) => void;
  onExit: () => void; onChanged: () => void; onLeave: () => void; onRetry: () => void;
}) {
  const [diagnosticError, setDiagnosticError] = useState('');
  return <PageLayout className="settings-page" title={<HomeLink navigate={navigate} />} navigation={header}>
    {section === 'personal' && diagnosticError && <HeaderNotice className="header-error" role="alert">{diagnosticError}</HeaderNotice>}
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
        {!ready ? <HeaderNotice>正在加载设置…</HeaderNotice> : <fieldset disabled={!enabled}>
          {section === 'personal' ? <div className="account-form">
            <div className="controls"><span>{user.username}{user.is_dev ? ' · dev' : ''}</span>
              {user.is_dev && <a className="button-link" href="/admin/" target="_blank" rel="noreferrer">Django Admin</a>}
              <button onClick={onExit}>退出账号</button>
            </div>
            <section className="account-form" aria-label="使用手册">
              <h2>使用手册</h2>
              <p>打轴入门、常用快捷键和 Aegisub 用户速查。</p>
              <div><RouteLink className="button-link" route={{ kind: 'handbook', organizationId: organization?.id }} navigate={navigate}>打开使用手册</RouteLink></div>
            </section>
            <PersonalPanel key={user.id} request={request} settings={settings} onSettings={onSettings} />
            <ExportDiagnostics onError={setDiagnosticError} />
          </div> : organization
            ? <><MembersPanel key={organization.id} currentUserId={user.id} isDev={user.is_dev} request={request}
              organization={organization} onChanged={onChanged} onLeave={onLeave} />
              {organizationStyles}</>
            : <div className="account-form"><HeaderNotice role="alert">组织不存在或无权访问。</HeaderNotice><button onClick={onRetry}>重新加载组织</button></div>}
        </fieldset>}
        {section === 'personal' && ready && !organization && <p>暂无可用组织。请联系管理员添加成员后使用组织设置。</p>}
      </section>
    </div>
  </PageLayout>;
}
