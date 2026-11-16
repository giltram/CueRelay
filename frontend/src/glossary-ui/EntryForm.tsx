import { useMessageState, useLocale } from '../i18n/react';
import { t } from "../i18n";
import { useId, useRef, useState } from 'react';
import type { EntryValues } from '../contracts/glossary';
import { validateEntry } from '../glossary-data/rules';

export function EntryForm({ initial, busy, disabled, error, conflict, onSave, onCancel, onReload }: {
  initial: EntryValues; busy: boolean; disabled: boolean; error: string; conflict: boolean;
  onSave: (values: EntryValues) => void; onCancel: () => void; onReload: () => void;
}) {
  useLocale();
  const id = useId();
  const composing = useRef(false);
  const [values, setValues] = useState<EntryValues>({ original: initial.original, translation: initial.translation, note: initial.note });
  const [validation, setValidation] = useMessageState('');
  return <form className="account-form glossary-form" aria-label={t("glossaryUi.glossaryEntry")}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
    onSubmit={event => {
    event.preventDefault(); const problem = validateEntry(values); setValidation(problem);
    if (!problem && !busy && !disabled && !composing.current) onSave(values);
  }}>
    <fieldset className="account-form" disabled={busy || disabled}>
      <div><label htmlFor={`${id}-original`}>{t("glossaryUi.originalTerm")}</label><input id={`${id}-original`} required value={values.original} onChange={event => setValues({ ...values, original: event.target.value })} /></div>
      <div><label htmlFor={`${id}-translation`}>{t("glossaryUi.preferredTranslation")}</label><input id={`${id}-translation`} required value={values.translation} onChange={event => setValues({ ...values, translation: event.target.value })} /></div>
      <div><label htmlFor={`${id}-note`}>{t("glossaryUi.note")}</label><textarea id={`${id}-note`} rows={2} value={values.note} onChange={event => setValues({ ...values, note: event.target.value })} /></div>
    </fieldset>
    <div className="controls"><button className="primary" disabled={busy || disabled}>{busy ? t("glossaryUi.saving") : t("glossaryUi.saveTerm")}</button>
      <button type="button" disabled={busy} onClick={onCancel}>{t("glossaryUi.cancel")}</button></div>
    {(validation || error) && <p role="alert">{validation || error}</p>}
    {conflict && <button type="button" disabled={busy || disabled} onClick={onReload}>{t("glossaryUi.reloadServerContent")}</button>}
  </form>;
}
