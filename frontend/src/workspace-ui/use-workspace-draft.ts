import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DraftAutosave, type DraftStatus } from '../workspace-drafts/autosave';
import type { DraftContent, TimingDraft, WorkspaceDraft } from '../workspace-drafts/model';
import { openDraftStore, type DraftStore } from '../workspace-drafts/store';
import { activeDraftTabs, draftTab, withInactiveDraftTab } from '../workspace-drafts/tab';
import { formatTime } from '../media/playback';
import type { EditState } from './edit-history';
import type { Cue } from '../contracts/subtitles';

export function unappliedTiming(state: EditState, cue?: Cue): TimingDraft | null {
  const unselectedEndMs = state.unselectedEndMs ?? 0;
  const start = formatTime(cue?.start_ms ?? 0);
  const end = formatTime(cue?.end_ms ?? unselectedEndMs);
  if (state.startText === start && state.endText === end) return null;
  return { cueId: state.selectedId, startText: state.startText, endText: state.endText,
    ...(cue ? {} : { unselectedEndMs }) };
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

  async function accessCandidate(record: WorkspaceDraft, action: 'read' | 'restore' | 'discard') {
    const current = session.current;
    if (!current?.mounted) return null;
    const access = () => current.store.accessCandidate(record, action === 'restore' && record.tabId !== current.tabId
      ? { kind: 'restore', tabId: current.tabId }
      : { kind: action === 'discard' ? 'discard' : 'read' });
    const matched = record.tabId === current.tabId ? await access() : await withInactiveDraftTab(record.tabId, access);
    if (!current.mounted) return null;
    if (matched && action === 'restore') current.autosave.adopt(matched);
    if (!matched || action !== 'read') {
      setCandidates(values => values.filter(value => value.id !== record.id));
    }
    return matched;
  }

  return {
    status, candidates, accessCandidate,
    flush: () => session.current?.autosave.flush(),
    discard: () => session.current?.autosave.discard(),
  };
}
