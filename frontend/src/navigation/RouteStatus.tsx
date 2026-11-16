import { formatMessage, t } from '../i18n';
import { useLocale } from "../i18n/react";
import { PageLayout, HeaderNotice } from '../page-ui/PageLayout';
import type { ReactNode } from 'react';
import { RouteLink } from './RouteLink';
import { HomeLink } from './HomeLink';
import type { Route } from './routes';

export function RouteStatus({ header, loading, error, notFound, organizationId, navigate, retry, exportDraft }: {
  header: ReactNode; loading?: boolean; error?: Error; notFound?: boolean; organizationId?: number;
  navigate: (route: Route) => void; retry?: () => void; exportDraft?: () => void;
}) {
  useLocale();
  const code = (error as { code?: string } | undefined)?.code;
  const text = loading ? t("navigation.loadingProject") : notFound ? t("navigation.pageNotFound") : code === 'permission_denied' ? t("navigation.accessToThisOrganizationOrProjectIsDenied")
    : code === 'not_found' ? t("navigation.theOrganizationOrProjectDoesNotExistOr")
      : code === 'authentication_required' || code === 'account_changed' ? t("navigation.signInToOpenThisProject") : t("navigation.couldNotLoadTheProjectPleaseTryAgain");
  return <PageLayout className="projects-page" title={<HomeLink navigate={navigate} />} navigation={header}>
    <HeaderNotice role={loading ? 'status' : 'alert'}>{text}</HeaderNotice>
    {error && <HeaderNotice role="alert">{formatMessage(error)}</HeaderNotice>}
    <div className="controls">
      {!loading && retry && <button onClick={retry}>{t("navigation.retryLoading")}</button>}
      <RouteLink className="button-link" target="_self" route={{ kind: 'projects', organizationId }} navigate={navigate}>{t("navigation.backToProjects")}</RouteLink>
      {organizationId !== undefined && <RouteLink className="button-link" target="_self" route={{ kind: 'projects' }} navigate={navigate}>{t("navigation.chooseAnAccessibleOrganization")}</RouteLink>}
      {exportDraft && <button onClick={exportDraft}>{t("navigation.exportAssFromRetainedWorkspace")}</button>}
    </div>
  </PageLayout>;
}
