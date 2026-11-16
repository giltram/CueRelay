import { useId } from 'react';
import { formatMessage, languageOptions, t, type LanguagePreference, type MessageValue } from './index';
import { useLocale } from './react';

export interface LanguageControl {
  preference: LanguagePreference; pending: boolean; error: MessageValue;
  select: (preference: LanguagePreference) => Promise<void>;
}
export function LanguageSelector({ control }: { control: LanguageControl }) {
  useLocale();
  const id = useId();
  return <div className="language-control">
    <label htmlFor={id}>{t('common.language')}</label>
    <select id={id} value={control.preference} disabled={control.pending} onChange={event => void control.select(event.target.value as LanguagePreference)}>
      <option value="system">{t('common.system')}</option>
      {languageOptions.map(language => <option key={language.id} value={language.id}>{language.label}</option>)}
    </select>
    {control.error && <span role="alert">{t('common.languageFailure', { reason: formatMessage(control.error) })}
      <button onClick={() => void control.select(control.preference)}>{t('common.retry')}</button></span>}
    {control.pending && <span className="sr-only" role="status">{t('common.languagePending')}</span>}
  </div>;
}
