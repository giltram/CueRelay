import { type MessageValue, describe, MessageError } from '../contracts/messages';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonRequest } from '../contracts/http';
import type { GlossaryAssociation, GlossaryEntry, GlossaryPage } from '../contracts/glossary';
import { glossaryApi } from './api';

export function useGlossary(request: JsonRequest, organizationId: number, projectId: number | undefined, enabled: boolean) {
  const api = useMemo(() => glossaryApi(request, organizationId, projectId), [request, organizationId, projectId]);
  const [data, setData] = useState<GlossaryPage | null>(null);
  const [search, setSearchValue] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<MessageValue>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const writing = useRef(false);
  const context = useRef({ api, enabled, generation: 0 });
  if (context.current.api !== api || context.current.enabled !== enabled) context.current.generation++;
  context.current = { ...context.current, api, enabled };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (!enabled || writing.current) return null;
    const serial = ++sequence.current;
    setLoading(true); setError('');
    try {
      const value = await api.read(search, page);
      if (!mounted.current || serial !== sequence.current || !context.current.enabled || context.current.api !== api) return null;
      setData(value); return value;
    } catch (reason) {
      if (mounted.current && serial === sequence.current && context.current.enabled && context.current.api === api) {
        setError(reason as Error);
        if (['permission_denied', 'not_found', 'authentication_required', 'account_changed', 'request_superseded'].includes((reason as { code?: string }).code ?? '')) setData(null);
      }
      return null;
    } finally { if (serial === sequence.current) setLoading(false); }
  }, [api, enabled, search, page]);
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    void refresh();
    const observe = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', observe); document.addEventListener('visibilitychange', observe);
    return () => { sequence.current++; window.removeEventListener('focus', observe); document.removeEventListener('visibilitychange', observe); };
  }, [refresh]);
  useEffect(() => { setData(null); setSearchValue(''); setPage(1); setError(''); }, [api]);

  async function write<T extends GlossaryAssociation & { entry?: GlossaryEntry }>(operation: () => Promise<T>): Promise<T> {
    if (!enabled || writing.current) throw new MessageError(describe("glossaryData.pleaseWaitForTheCurrentOperationToFinish", "请等待当前操作完成。"));
    const generation = context.current.generation;
    writing.current = true; sequence.current++; setBusy(true); setLoading(false);
    try {
      const value = await operation();
      if (!mounted.current || generation !== context.current.generation || !context.current.enabled || context.current.api !== api) throw new MessageError(describe("glossaryData.theGlossaryContextChangedPleaseReopenIt", "术语表上下文已变化，请重新打开。"));
      // Only resource state is accepted; there is no subtitle revision/document here.
      if (data?.table?.id !== value.table?.id) setPage(1);
      setData(previous => {
        if (!previous) return null;
        const changedTable = previous.table?.id !== value.table?.id;
        const next: GlossaryPage = { ...previous, ...value, ...(changedTable ? { entries: [], empty: true, total: 0, has_more: false } : {}) };
        if (value.entry) {
          const entry = value.entry;
          const matches = [entry.original, entry.translation, entry.note].some(text => text.toLowerCase().includes(search.trim().toLowerCase()));
          const existed = next.entries.some(row => row.id === entry.id);
          next.entries = next.entries.filter(row => row.id !== entry.id);
          if (matches && (existed || page === 1)) next.entries = [entry, ...next.entries].slice(0, 25);
          next.empty = false;
          next.total = Math.max(next.total, next.entries.length);
        }
        return next;
      });
      return value;
    } finally {
      writing.current = false;
      if (mounted.current && context.current.api === api) { setBusy(false); void refreshRef.current(); }
    }
  }
  return { api, data, search, page, error, loading, busy, enabled, refresh, write,
    setSearch(value: string) { sequence.current++; setSearchValue(value); setPage(1); },
    setPage(value: number) { sequence.current++; setPage(value); } };
}
export type GlossaryStore = ReturnType<typeof useGlossary>;
