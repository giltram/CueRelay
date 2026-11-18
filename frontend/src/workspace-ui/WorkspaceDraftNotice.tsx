import { useState } from 'react';
import { i18n, t } from '../i18n';
import { HeaderNotice } from '../page-ui/PageLayout';
import type { DraftStatus } from '../workspace-drafts/autosave';
import type { WorkspaceDraft } from '../workspace-drafts/model';

interface Props {
  status: DraftStatus;
  candidates: WorkspaceDraft[];
  revision: number | null;
  revisionChanged: boolean;
  canRestore: boolean;
  disabled: boolean;
  onRestore: (draft: WorkspaceDraft) => void;
  onExport: (draft: WorkspaceDraft) => void;
  onDiscard: (draft: WorkspaceDraft) => void;
}

export function WorkspaceDraftNotice({ status, candidates, revision, revisionChanged, canRestore, disabled, onRestore, onExport, onDiscard }: Props) {
  const [open, setOpen] = useState(true);
  return <>
    {status !== 'idle' && <HeaderNotice className={status === 'failed' ? 'header-warning' : undefined}>
      {status === 'saving' ? t('workspaceUi.draftSaving')
        : status === 'saved' ? t('workspaceUi.draftSaved') : t('workspaceUi.draftFailed')}
    </HeaderNotice>}
    {candidates.length > 0 && (open ? (
      <section className="confirm workspace-drafts" aria-label={t('workspaceUi.draftsFound')} data-workspace-drafts>
        <div className="controls">
          <strong>{t('workspaceUi.draftsFound')}</strong>
          <button onClick={() => setOpen(false)} disabled={disabled}>
            {revisionChanged ? t('workspaceUi.draftKeepCurrent') : revision === null ? t('workspaceUi.draftUseOriginal') : t('workspaceUi.draftUseServer')}
          </button>
        </div>
        {candidates.map(draft => {
          const conflict = revisionChanged || draft.baseRevision !== revision;
          return <div key={draft.id} className="controls">
            <time dateTime={new Date(draft.updatedAt).toISOString()}>
              {new Date(draft.updatedAt).toLocaleString(i18n.language)}
            </time>
            {conflict && <span>{revisionChanged ? t('workspaceUi.draftConflictReload') : t('workspaceUi.draftConflict')}</span>}
            {draft.timing && conflict && <span>{t('workspaceUi.draftTiming', {
              start: draft.timing.startText, end: draft.timing.endText,
            })}</span>}
            {!conflict && <button disabled={disabled || !canRestore} onClick={() => onRestore(draft)}>{t('workspaceUi.draftRestore')}</button>}
            <button disabled={disabled} onClick={() => onExport(draft)}>{t('workspaceUi.draftExport')}</button>
            <button disabled={disabled} onClick={() => onDiscard(draft)}>{t('workspaceUi.draftDiscard')}</button>
          </div>;
        })}
      </section>
    ) : <HeaderNotice><button onClick={() => setOpen(true)}>{t('workspaceUi.draftShow')}</button></HeaderNotice>)}
  </>;
}
