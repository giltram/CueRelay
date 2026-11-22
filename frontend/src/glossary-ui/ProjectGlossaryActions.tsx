import { useMessageState, useLocale } from '../i18n/react';
import { t } from "../i18n";
import { useEffect, useRef, useState } from 'react';
import { associationToken } from '../contracts/glossary';
import type { GlossaryStore } from '../glossary-data/use-glossary';

/** Forking and reverting the association have independent business permissions. */
export function ProjectGlossaryActions({ store, canUseOrganizationDefault = false, canFork = true }: { store: GlossaryStore; canUseOrganizationDefault?: boolean; canFork?: boolean }) {
  useLocale();
  const [error, setError] = useMessageState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const data = store.data;
  if (!data || data.archived) return null;
  async function change(fork: boolean) {
    if (!data) return;
    setError('');
    try {
      await store.write(() => store.api.associate(associationToken(data), fork ? { fork: true } : { use_organization_default: true }));
    } catch (reason) { if (mounted.current) setError(reason as Error); }
  }
  return <div className="glossary-association" data-glossary>
    {data.uses_organization_default ? <>
      <p className="hint">{t("glossaryUi.theOrganizationGlossaryIsReadOnlyHereCreate")}</p>
      {canFork && <div><button disabled={!store.enabled || store.busy || store.loading} onClick={() => void change(true)}>{t("glossaryUi.createProjectCopy")}</button></div>}
    </> : <>
      <p className="hint">{t("glossaryUi.theseEntriesBelongToTheProjectGlossaryChanges")}</p>
      {canUseOrganizationDefault && <div><button disabled={!store.enabled || store.busy || store.loading} onClick={() => void change(false)}>{t("glossaryUi.useOrganizationGlossary")}</button></div>}
    </>}
    {error && <div role="alert">{error}<button disabled={store.loading || store.busy} onClick={() => void store.refresh()}>{t("glossaryUi.refreshCurrentLink")}</button></div>}
  </div>;
}
