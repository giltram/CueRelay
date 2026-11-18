import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DraftAutosave, type DraftStatus } from '../workspace-drafts/autosave';
import type { DraftContent, TimingDraft, WorkspaceDraft } from '../workspace-drafts/model';
import { openDraftStore, type DraftStore } from '../workspace-drafts/store';
import { activeDraftTabs, draftTab, withInactiveDraftTab } from '../workspace-drafts/tab';
import { formatTime } from '../media/playback';
import type { EditState } from './edit-history';
import type { Cue } from '../contracts/subtitles';

export function unappliedTiming(state: EditState, cue?: Cue): TimingDraft | null {
  const start = cue ? formatTime(cue.start_ms) : '0:00:00.00';
  // Empty projects start with the proposed duration. Removing the last row
  // resets both displayed inputs to zero through withSelection.
  const end = cue ? formatTime(cue.end_ms) : state.selectedIds ? '0:00:00.00' : '0:00:02.00';
  return (cue || !state.document?.cues.length) && (state.startText !== start || state.endText !== end)
    ? { cueId: state.selectedId, startText: state.startText, endText: state.endText } : null;
}

interface Session { store: DraftStore; tabId: string; autosave: DraftAutosave; mounted: boolean }

/** Observe immutable editor snapshots. The editor continues to own all edit state. */
export function useWorkspaceDraft(scope: string | undefined, content: DraftContent | null) {
  const [status, setStatus] = useState<DraftStatus>('idle');
  const [candidates, setCandidates] = useState<WorkspaceDraft[]>([]);
  const session = useRef<Session | null>(null);
  const latest = useRef(content);
  useLayoutEffect(() => {
    latest.current = content;
    session.current?.autosave.update(content);
  }, [content]);

  useEffect(() => {
    if (!scope) return;
    let mounted = true;
    void Promise.all([openDraftStore(), draftTab()]).then(async ([store, tabId]) => {
      const records = await store.list(scope);
      const activeTabs = await activeDraftTabs();
      if (!mounted) return;
      const autosave = new DraftAutosave(store, scope, tabId, value => { if (mounted) setStatus(value); });
      session.current = { store, tabId, autosave, mounted: true };
      setCandidates(records.filter(record => record.tabId === tabId || !activeTabs.has(record.tabId)));
      autosave.update(latest.current);
    }).catch(() => { if (mounted) setStatus('failed'); });

    const flush = () => session.current?.autosave.flush();
    const onVisibility = () => { if (window.document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted = false;
      flush();
      if (session.current) session.current.mounted = false;
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      window.document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [scope]);

  async function resolveCandidate(record: WorkspaceDraft, restore: boolean) {
    const current = session.current;
    if (!current?.mounted) return false;
    const change = () => current.store.changeCandidate(record, restore ? current.tabId : null);
    if (record.tabId !== current.tabId) await withInactiveDraftTab(record.tabId, change);
    else if (!restore) await change();
    if (!current.mounted) return false;
    if (restore) current.autosave.adopt(record);
    setCandidates(values => values.filter(value => value.id !== record.id));
    return true;
  }

  return {
    status, candidates, resolveCandidate,
    flush: () => session.current?.autosave.flush(),
    discard: () => session.current?.autosave.discard(),
  };
}
