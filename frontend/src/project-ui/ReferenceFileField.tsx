import { t } from '../i18n';
import { useLocale } from '../i18n/react';

export function ReferenceFileField({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => void }) {
  useLocale();
  return <label className="file-picker">{t('reference.choose')}
    <input type="file" accept=".srt" disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) onFile(file);
    }} />
  </label>;
}
