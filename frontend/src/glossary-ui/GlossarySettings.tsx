import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import type { JsonRequest } from '../contracts/http';
import { useGlossary } from '../glossary-data/use-glossary';
import { GlossaryBrowser } from './GlossaryBrowser';
import { ProjectGlossaryActions } from './ProjectGlossaryActions';

export function GlossarySettings({ request, organizationId, projectId, enabled, archived, canUseOrganizationDefault, canFork = true, editable = true }: {
  request: JsonRequest; organizationId: number; projectId: number; enabled: boolean; archived: boolean; canUseOrganizationDefault: boolean; canFork?: boolean; editable?: boolean;
}) {
  useLocale();
  const store = useGlossary(request, organizationId, projectId, enabled);
  const active = enabled && !archived && !store.data?.archived;
  return <section className="account-form" aria-label={t("glossaryUi.projectGlossary")} data-glossary>
    <h2>{t("glossaryUi.glossary")}</h2>
    {!archived && <ProjectGlossaryActions store={store} canUseOrganizationDefault={canUseOrganizationDefault} canFork={canFork} />}
    <GlossaryBrowser store={store} editable={active && editable && store.data?.uses_organization_default === false} table />
  </section>;
}
