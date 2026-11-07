import { useState } from 'react';
import { Modal } from '../page-ui/Modal';
import type { PasteField } from '../project-data/ass-api';

const fields: { id: PasteField; label: string }[] = [
  { id: 'start_ms', label: '入点' }, { id: 'end_ms', label: '出点' }, { id: 'style_id', label: '样式' }, { id: 'text', label: '正文' },
];
export function PasteOverDialog({ busy, error, onClose, onApply }: { busy: boolean; error: string; onClose: () => void; onApply: (fields: PasteField[]) => void }) {
  const [selected, setSelected] = useState<PasteField[]>(['text']);
  return <Modal title="选择字段粘贴覆盖字幕行" onClose={busy ? undefined : onClose}>
    <p>选择需要覆盖的字段，其余内容保持原值。</p>
    <div className="paste-fields">{fields.map(field => <label key={field.id}>
      <input type="checkbox" checked={selected.includes(field.id)} disabled={busy} onChange={event => setSelected(event.target.checked ? [...selected, field.id] : selected.filter(id => id !== field.id))} />{field.label}
    </label>)}</div>
    {error && <p role="alert">{error}</p>}
    <div className="controls"><button disabled={busy} onClick={onClose}>取消</button>
      <button className="primary" disabled={busy || !selected.length} onClick={() => onApply(selected)}>粘贴覆盖</button></div>
  </Modal>;
}
