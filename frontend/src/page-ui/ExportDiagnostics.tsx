import type { MessageValue } from '../contracts/messages';
import { msg, t } from "../i18n";
import { useLocale } from "../i18n/react";
import { useState } from 'react';
import { downloadDiagnostics } from '../diagnostics/export';

export function ExportDiagnostics({ onError }: { onError: (message: MessageValue) => void }) {
  useLocale();
  const [busy, setBusy] = useState(false);
  return <div className="diagnostic-export">
    <button disabled={busy} onClick={() => {
      setBusy(true); onError('');
      void downloadDiagnostics().catch(() => onError(msg("diagnostics.couldNotExportDiagnosticsPleaseTryAgain"))).finally(() => setBusy(false));
    }}>{busy ? t("diagnostics.exporting") : t("diagnostics.exportDiagnostics")}</button>
    <span>{t("diagnostics.includesUsernameUserIdPermissionsRecentActionsAnd")}</span>
  </div>;
}
