import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import type { JsonRequest } from '../contracts/http';
import { useGlossary } from '../glossary-data/use-glossary';
import { GlossaryBrowser } from './GlossaryBrowser';

/** One organization default, using the same entry forms and concurrency boundary. */
export function OrganizationGlossary({ request, organizationId, enabled, editable = true }: {
  request: JsonRequest; organizationId: number; enabled: boolean; editable?: boolean;
}) {
  useLocale();
  const store = useGlossary(request, organizationId, undefined, enabled);
  return <section className="account-form organization-glossary" aria-label={t("glossaryUi.organizationGlossary")} data-glossary>
    <h2>{t("glossaryUi.organizationGlossary")}</h2>
    <p className="hint">{t("glossaryUi.projectsUseThisGlossaryByDefaultProjectsWith")}</p>
    <GlossaryBrowser store={store} editable={enabled && editable} table />
  </section>;
}
