import { useEffect, useRef, useState } from 'react';
import { associationToken, type AssociationToken, type EntryValues, type GlossaryEntry } from '../contracts/glossary';
import { glossaryLimits } from '../glossary-data/rules';
import type { GlossaryStore } from '../glossary-data/use-glossary';
import { EntryForm } from './EntryForm';
import './glossary.css';

interface Draft { entry?: GlossaryEntry; initial: EntryValues; token: AssociationToken; key: number }
export function GlossaryBrowser({ store, editable, table = false, onInsert, canInsert = false }: {
  store: GlossaryStore; editable: boolean; table?: boolean; onInsert?: (translation: string) => void; canInsert?: boolean;
}) {
  const { data, busy, loading, error } = store;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState('');
  const serial = useRef(0);
  const mountedContext = useRef(store.api); mountedContext.current = store.api;
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [reloading, setReloading] = useState(false);
  function edit(entry?: GlossaryEntry) {
    if (!data) return;
    setFormError(''); setConflict(false); setMessage('');
    setDraft({ entry, initial: entry ?? { original: data.total === 0 ? store.search : '', translation: '', note: '' },
      token: associationToken(data), key: ++serial.current });
  }
  async function save(values: EntryValues) {
    if (!draft || !editable) return;
    const current = draft, api = store.api;
    setFormError(''); setConflict(false);
    try {
      await store.write(() => api.save(current.token, values, current.entry));
      if (!active.current || mountedContext.current !== api) return;
      setDraft(null); setMessage('术语已保存。');
    } catch (reason) {
      if (!active.current || mountedContext.current !== api) return;
      setFormError((reason as Error).message);
      setConflict(['glossary_conflict', 'glossary_association_conflict'].includes((reason as { code?: string }).code ?? ''));
    }
  }
  async function reloadDraft() {
    if (!draft || reloading) return;
    const api = store.api; setReloading(true);
    try {
      const latest = await store.refresh();
      if (!active.current || mountedContext.current !== api || !latest) return;
      if (latest.table?.id !== draft.token.glossary_id || !draft.entry) {
        setDraft(null); setMessage('已加载当前术语表，请核对后重新添加。');
      } else {
        const entry = await api.entry(latest.table.id, draft.entry.id);
        if (!active.current || mountedContext.current !== api) return;
        setDraft({ entry, initial: entry, token: associationToken(latest), key: ++serial.current });
      }
      setFormError(''); setConflict(false);
    } catch (reason) { if (active.current && mountedContext.current === api) setFormError((reason as Error).message); }
    finally { if (active.current && mountedContext.current === api) setReloading(false); }
  }
  return <div className="glossary-browser" data-glossary onKeyDown={event => event.stopPropagation()}>
    {data?.table && <div className="glossary-summary"><strong>{data.table.name}</strong>{data.uses_organization_default && <span> · 组织默认</span>}
      {data.table.project_count > 1 && <p className="hint">此术语表被 {data.table.project_count} 个项目使用，修改后其他关联项目也会看到。</p>}</div>}
    {data?.archived && <p className="hint">项目已归档，术语表仅可查看。</p>}
    <label>查询原词、译名或备注<input value={store.search} maxLength={glossaryLimits.search} onChange={event => store.setSearch(event.target.value)} /></label>
    <div className="controls"><button disabled={loading || busy || !store.enabled} onClick={() => void store.refresh()}>刷新术语表</button></div>
    {loading && <p role="status">正在加载术语…</p>}
    {error && <div role="alert">{error}<button disabled={loading || !store.enabled} onClick={() => void store.refresh()}>重试</button></div>}
    {data && <>
      {!data.table ? <p>{data.uses_organization_default ? '组织术语表还没有词条。' : '还没有术语，添加第一条术语。'}</p>
        : data.empty ? <p>此术语表还没有词条。</p>
          : data.entries.length === 0 ? <p>没有匹配的术语。</p> : null}
      {table ? <div className="glossary-table-scroll"><table aria-label="术语词条列表"><thead><tr><th>原词</th><th>统一译名</th><th>备注</th><th>编辑</th></tr></thead>
        <tbody>{data.entries.map(entry => <tr key={entry.id}><td>{entry.original}</td><td>{entry.translation}</td><td>{entry.note}</td><td>
          <button disabled={!editable || busy || Boolean(draft)} onClick={() => edit(entry)}>编辑</button></td></tr>)}</tbody></table></div>
        : <ul className="glossary-entries">{data.entries.map(entry => <li key={entry.id}>
          <strong>{entry.original}</strong><div>{entry.translation}</div>{entry.note && <p className="hint">{entry.note}</p>}
          <div className="controls"><button disabled={!canInsert} onClick={() => onInsert?.(entry.translation)}>插入</button>
            <button disabled={!editable || busy || Boolean(draft)} onClick={() => edit(entry)}>编辑</button></div></li>)}</ul>}
      {(data.has_more || store.page > 1) && <div className="controls">
        <button disabled={store.page <= 1 || loading} onClick={() => store.setPage(store.page - 1)}>上一页</button><span>第 {store.page} 页</span>
        <button disabled={!data.has_more || loading} onClick={() => store.setPage(store.page + 1)}>下一页</button></div>}
      {draft ? <EntryForm key={draft.key} initial={draft.initial} busy={busy || reloading} disabled={!editable}
        error={formError} conflict={conflict} onSave={values => void save(values)} onCancel={() => { setDraft(null); setFormError(''); }} onReload={() => void reloadDraft()} />
        : editable && <button disabled={busy || loading || Boolean(error)} onClick={() => edit()}>添加术语</button>}
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
