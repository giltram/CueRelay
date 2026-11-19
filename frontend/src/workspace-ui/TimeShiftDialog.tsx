import { useId, useRef, useState } from 'react';
import type { MessageDescriptor } from '../contracts/messages';
import { formatMessage, msg, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { Modal } from '../page-ui/Modal';

export type TimeShiftScope = 'selected' | 'all';

interface Props {
  selectedCount: number;
  totalCount: number;
  pendingTiming: boolean;
  onClose: () => void;
  onApply: (scope: TimeShiftScope, offsetMs: number) => MessageDescriptor | void;
}

export function TimeShiftDialog({ selectedCount, totalCount, pendingTiming, onClose, onApply }: Props) {
  useLocale();
  const id = useId();
  const composing = useRef(false);
  const [scope, setScope] = useState<TimeShiftScope>('selected');
  const [offset, setOffset] = useState('');
  const [error, setError] = useState<MessageDescriptor>();
  const count = scope === 'selected' ? selectedCount : totalCount;
  const canApply = count > 0 && !pendingTiming && Boolean(offset.trim());

  return <Modal title={t('workspaceUi.timeShift')} onClose={() => { if (!composing.current) onClose(); }} showCloseButton={false}>
    <form className="time-shift-form"
      onCompositionStart={event => { event.stopPropagation(); composing.current = true; }}
      onCompositionEnd={event => { event.stopPropagation(); composing.current = false; }}
      onKeyDown={event => {
        if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
      }}
      onSubmit={event => {
        event.preventDefault();
        if (!canApply || composing.current) return;
        const value = offset.trim();
        setError(/^(?:[+-][0-9]+|0)$/.test(value)
          ? onApply(scope, Number(value)) || undefined
          : msg('workspaceUi.timeShiftInvalidOffset'));
      }}>
      <div>
        <label htmlFor={`${id}-offset`}>{t('workspaceUi.timeShiftOffset')}</label>
        <input id={`${id}-offset`} aria-describedby={`${id}-hint`} autoComplete="off" value={offset}
          onChange={event => { setOffset(event.target.value); setError(undefined); }} />
        <p id={`${id}-hint`} className="hint">{t('workspaceUi.timeShiftHint')}</p>
      </div>
      <div>
        <label htmlFor={`${id}-scope`}>{t('workspaceUi.timeShiftScope')}</label>
        <select id={`${id}-scope`} value={scope} onChange={event => {
          setScope(event.target.value === 'all' ? 'all' : 'selected'); setError(undefined);
        }}>
          <option value="selected">{t('workspaceUi.timeShiftSelected')}</option>
          <option value="all">{t('workspaceUi.timeShiftAll')}</option>
        </select>
      </div>
      <p role="status">{t('workspaceUi.timeShiftCount', { count })}</p>
      {(pendingTiming || error) && <p className="header-error" role="alert">
        {pendingTiming ? t('workspaceUi.applyOrRestoreTimeDraft') : formatMessage(error)}
      </p>}
      <div className="controls">
        <button type="submit" className="primary" disabled={!canApply}>{t('workspaceUi.timeShiftApply')}</button>
        <button type="button" onClick={onClose}>{t('workspaceUi.cancel')}</button>
      </div>
    </form>
  </Modal>;
}
