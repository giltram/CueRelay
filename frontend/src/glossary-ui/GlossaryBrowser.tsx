import { useMessageState, useLocale } from '../i18n/react';
import { msg, t, formatMessage } from "../i18n";
import { useEffect, useRef, useState } from 'react';
import { associationToken, type AssociationToken, type EntryValues, type GlossaryEntry } from '../contracts/glossary';
import { glossaryLimits } from '../glossary-data/rules';
import type { GlossaryStore } from '../glossary-data/use-glossary';
import { EntryForm } from './EntryForm';
import './glossary.css';

interface Draft { entry?: GlossaryEntry; initial: EntryValues; token: AssociationToken; key: number }
export function GlossaryBrowser({ store, editable, table = false, onInsert, canInsert = false }: {
  store: GlossaryStore; editable: boolean; table?: boolean; onInsert?: (translation: string) => void; canInsert?: boolean;
}) {
  useLocale();
  const { data, busy, loading, error } = store;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useMessageState('');
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useMessageState('');
  const serial = useRef(0);
  const mountedContext = useRef(store.api); mountedContext.current = store.api;
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [reloading, setReloading] = useState(false);
  function edit(entry?: GlossaryEntry) {
    if (!data) return;
    setFormError(''); setConflict(false); setMessage('');
    setDraft({ entry, initial: entry ?? { original: data.total === 0 ? store.search : '', translation: '', note: '' },
      token: associationToken(data), key: ++serial.current });
  }
  async function save(values: EntryValues) {
    if (!draft || !editable) return;
    const current = draft, api = store.api;
    setFormError(''); setConflict(false);
    try {
      await store.write(() => api.save(current.token, values, current.entry));
      if (!active.current || mountedContext.current !== api) return;
      setDraft(null); setMessage(msg("glossaryUi.termSaved"));
    } catch (reason) {
      if (!active.current || mountedContext.current !== api) return;
      setFormError(reason as Error);
      setConflict(['glossary_conflict', 'glossary_association_conflict'].includes((reason as { code?: string }).code ?? ''));
    }
  }
  async function reloadDraft() {
    if (!draft || reloading) return;
    const api = store.api; setReloading(true);
    try {
      const latest = await store.refresh();
      if (!active.current || mountedContext.current !== api || !latest) return;
      if (latest.table?.id !== draft.token.glossary_id || !draft.entry) {
        setDraft(null); setMessage(msg("glossaryUi.currentGlossaryLoadedCheckItBeforeAddingThe"));
      } else {
        const entry = await api.entry(latest.table.id, draft.entry.id);
        if (!active.current || mountedContext.current !== api) return;
        setDraft({ entry, initial: entry, token: associationToken(latest), key: ++serial.current });
      }
      setFormError(''); setConflict(false);
    } catch (reason) { if (active.current && mountedContext.current === api) setFormError(reason as Error); }
    finally { if (active.current && mountedContext.current === api) setReloading(false); }
  }
  return <div className="glossary-browser" data-glossary onKeyDown={event => event.stopPropagation()}>
    {data?.table && <div className="glossary-summary"><strong>{data.uses_organization_default ? t("glossaryUi.organizationGlossary") : data.table.name}</strong>{data.uses_organization_default && <span> {t("glossaryUi.organizationDefault")}</span>}
      {data.table.project_count > 1 && <p className="hint">{t("glossaryUi.sharedUsage", { count: data.table.project_count })}</p>}</div>}
    {data?.archived && <p className="hint">{t("glossaryUi.thisProjectIsArchivedTheGlossaryIsRead")}</p>}
    <label>{t("glossaryUi.searchOriginalTermsTranslationsOrNotes")}<input value={store.search} maxLength={glossaryLimits.search} onChange={event => store.setSearch(event.target.value)} /></label>
    <div className="controls"><button disabled={loading || busy || !store.enabled} onClick={() => void store.refresh()}>{t("glossaryUi.refreshGlossary")}</button></div>
    {loading && <p role="status">{t("glossaryUi.loadingTerms")}</p>}
    {error && <div role="alert">{formatMessage(error)}<button disabled={loading || !store.enabled} onClick={() => void store.refresh()}>{t("glossaryUi.retry")}</button></div>}
    {data && <>
      {!data.table ? <p>{data.uses_organization_default ? t("glossaryUi.theOrganizationGlossaryHasNoEntriesYet") : t("glossaryUi.noTermsYetAddTheFirstTerm")}</p>
        : data.empty ? <p>{t("glossaryUi.thisGlossaryHasNoEntriesYet")}</p>
          : data.entries.length === 0 ? <p>{t("glossaryUi.noMatchingTerms")}</p> : null}
      {table ? <div className="glossary-table-scroll"><table aria-label={t("glossaryUi.glossaryEntries")}><thead><tr><th>{t("glossaryUi.originalTerm")}</th><th>{t("glossaryUi.preferredTranslation")}</th><th>{t("glossaryUi.note")}</th><th>{t("glossaryUi.edit")}</th></tr></thead>
        <tbody>{data.entries.map(entry => <tr key={entry.id}><td>{entry.original}</td><td>{entry.translation}</td><td>{entry.note}</td><td>
          <button disabled={!editable || busy || Boolean(draft)} onClick={() => edit(entry)}>{t("glossaryUi.edit")}</button></td></tr>)}</tbody></table></div>
        : <ul className="glossary-entries">{data.entries.map(entry => <li key={entry.id}>
          <strong>{entry.original}</strong><div>{entry.translation}</div>{entry.note && <p className="hint">{entry.note}</p>}
          <div className="controls"><button disabled={!canInsert} onClick={() => onInsert?.(entry.translation)}>{t("glossaryUi.insert")}</button>
            <button disabled={!editable || busy || Boolean(draft)} onClick={() => edit(entry)}>{t("glossaryUi.edit")}</button></div></li>)}</ul>}
      {(data.has_more || store.page > 1) && <div className="controls">
        <button disabled={store.page <= 1 || loading} onClick={() => store.setPage(store.page - 1)}>{t("glossaryUi.previousPage")}</button><span>{t("glossaryUi.pagination", { page: store.page })}</span>
        <button disabled={!data.has_more || loading} onClick={() => store.setPage(store.page + 1)}>{t("glossaryUi.nextPage")}</button></div>}
      {draft ? <EntryForm key={draft.key} initial={draft.initial} busy={busy || reloading} disabled={!editable}
        error={formError} conflict={conflict} onSave={values => void save(values)} onCancel={() => { setDraft(null); setFormError(''); }} onReload={() => void reloadDraft()} />
        : editable && <button disabled={busy || loading || Boolean(error)} onClick={() => edit()}>{t("glossaryUi.addTerm")}</button>}
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
