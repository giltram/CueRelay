import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import { useState } from 'react';
import { Modal } from '../page-ui/Modal';
import type { PasteField } from '../project-data/ass-api';

function translatedFields(): { id: PasteField; label: string }[] { return [
  { id: 'start_ms', label: t("workspaceUi.start") }, { id: 'end_ms', label: t("workspaceUi.end") }, { id: 'style_id', label: t("workspaceUi.style") }, { id: 'text', label: t("workspaceUi.text") },
]; }
export function PasteOverDialog({ busy, error, onClose, onApply }: { busy: boolean; error: string; onClose: () => void; onApply: (fields: PasteField[]) => void }) {
  useLocale();
  const [selected, setSelected] = useState<PasteField[]>(['text']);
  return <Modal title={t("workspaceUi.pasteLinesOver")} onClose={busy ? undefined : onClose}>
    <p>{t("workspaceUi.chooseTheFieldsToReplaceOtherValuesRemain")}</p>
    <div className="paste-fields">{translatedFields().map(field => <label key={field.id}>
      <input type="checkbox" checked={selected.includes(field.id)} disabled={busy} onChange={event => setSelected(event.target.checked ? [...selected, field.id] : selected.filter(id => id !== field.id))} />{field.label}
    </label>)}</div>
    {error && <p role="alert">{error}</p>}
    <div className="controls"><button disabled={busy} onClick={onClose}>{t("workspaceUi.cancel")}</button>
      <button className="primary" disabled={busy || !selected.length} onClick={() => onApply(selected)}>{t("workspaceUi.pasteOver")}</button></div>
  </Modal>;
}
