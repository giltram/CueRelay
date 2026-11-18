import { useMessageState, useLocale } from '../i18n/react';
import { t } from "../i18n";
import { LanguageSelector, type LanguageControl } from '../i18n/LanguageSelector';
import { PageLayout, HeaderNotice } from '../page-ui/PageLayout';
import { ExportDiagnostics } from '../page-ui/ExportDiagnostics';
import { useState, type ReactNode } from 'react';
import type { AccountRequest, Organization, Settings, User } from './api';
import { MembersPanel } from './MembersPanel';
import { PersonalPanel } from './PersonalPanel';
import { HomeLink } from '../navigation/HomeLink';
import { RouteLink } from '../navigation/RouteLink';
import type { Route } from '../navigation/routes';

/** Page layout only; App owns session, organization selection and guarded actions. */
export function SettingsPage({ user, organization, section, header, organizationStyles, organizationGlossary, enabled, ready, request, settings, language, navigate,
  onSettings, onExit, onChanged, onLeave, onRetry }: {
  user: User; organization?: Organization; section: 'personal' | 'organization'; header: ReactNode;
  enabled: boolean; ready: boolean; request: AccountRequest; settings: Settings; language: LanguageControl;
  organizationStyles?: ReactNode; organizationGlossary?: ReactNode;
  navigate: (route: Route) => void; onSettings: (changes: Partial<Settings>) => void;
  onExit: () => void; onChanged: () => void; onLeave: () => void; onRetry: () => void;
}) {
  useLocale();
  const [diagnosticError, setDiagnosticError] = useMessageState('');
  return <PageLayout className="settings-page" title={<HomeLink navigate={navigate} />} navigation={header}>
    {section === 'personal' && diagnosticError && <HeaderNotice className="header-error" role="alert">{diagnosticError}</HeaderNotice>}
    <h2 className="settings-title">{t("accountUi.settings")}</h2>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t("accountUi.settingsCategories")}>
        <RouteLink route={{ kind: 'settings', organizationId: organization?.id }} navigate={navigate} target="_self" aria-current={section === 'personal' ? 'page' : undefined}>{t("accountUi.personalSettings")}</RouteLink>
        {organization
          ? <RouteLink route={{ kind: 'organization-settings', organizationId: organization.id }} navigate={navigate} target="_self"
            aria-current={section === 'organization' ? 'page' : undefined}>{t("accountUi.organizationSettings")}</RouteLink>
          : <span aria-disabled="true">{t("accountUi.organizationSettings")}</span>}
      </nav>
      <section className="settings-content" aria-label={section === 'personal' ? t("accountUi.personalSettings") : t("accountUi.organizationSettings")}>
        <h2>{section === 'personal' ? t("accountUi.personalSettings") : t("accountUi.organizationSettings")}</h2>
        {section === 'personal' && <fieldset disabled={!enabled}><LanguageSelector control={language} /></fieldset>}
        {!ready ? <HeaderNotice>{t("accountUi.loadingSettings")}</HeaderNotice> : <fieldset disabled={!enabled}>
          {section === 'personal' ? <div className="account-form">
            <div className="controls"><span>{user.username}{user.is_dev ? ' · dev' : ''}</span>
              {user.is_dev && <a className="button-link" href="/admin/" target="_blank" rel="noreferrer">Django Admin</a>}
              <button onClick={onExit}>{t("accountUi.signOut")}</button>
            </div>
            <section className="account-form" aria-label={t("accountUi.handbook")}>
              <h2>{t("accountUi.handbook")}</h2>
              <p>{t("accountUi.learnTimingCommonShortcutsAndTheAegisubQuick")}</p>
              <div><RouteLink className="button-link" route={{ kind: 'handbook', organizationId: organization?.id }} navigate={navigate}>{t("accountUi.openHandbook")}</RouteLink></div>
            </section>
            <PersonalPanel key={user.id} request={request} settings={settings} onSettings={onSettings} />
            <ExportDiagnostics onError={setDiagnosticError} />
          </div> : organization
            ? <><MembersPanel key={organization.id} currentUserId={user.id} isDev={user.is_dev} request={request}
              organization={organization} onChanged={onChanged} onLeave={onLeave} />
              {organizationGlossary}{organizationStyles}</>
            : <div className="account-form"><HeaderNotice role="alert">{t("accountUi.organizationNotFoundOrAccessDenied")}</HeaderNotice><button onClick={onRetry}>{t("accountUi.reloadOrganizations")}</button></div>}
        </fieldset>}
        {section === 'personal' && ready && !organization && <p>{t("accountUi.noOrganizationsAvailableAskAnAdministratorToAdd")}</p>}
      </section>
    </div>
  </PageLayout>;
}
