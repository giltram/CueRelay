import { useEffect, useRef, useState } from 'react';
import { associationToken } from '../contracts/glossary';
import type { GlossaryStore } from '../glossary-data/use-glossary';

/** Project members can fork; reverting an association retains project management rights. */
export function ProjectGlossaryActions({ store, canManage = false }: { store: GlossaryStore; canManage?: boolean }) {
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const data = store.data;
  if (!data || data.archived) return null;
  async function change(fork: boolean) {
    if (!data) return;
    setError('');
    try {
      await store.write(() => store.api.associate(associationToken(data), fork ? { fork: true } : { use_organization_default: true }));
    } catch (reason) { if (mounted.current) setError((reason as Error).message); }
  }
  return <div className="glossary-association" data-glossary>
    {data.uses_organization_default ? <>
      <p className="hint">当前使用组织术语表，只可查询。创建项目副本后可自由修改；副本不再同步组织词条，也不会回写组织表。</p>
      <div><button disabled={!store.enabled || store.busy || store.loading} onClick={() => void change(true)}>创建项目副本</button></div>
    </> : <>
      <p className="hint">当前词条属于项目术语表，修改不会回写组织表，也不会自动接收组织表的新词条。</p>
      {canManage && <div><button disabled={!store.enabled || store.busy || store.loading} onClick={() => void change(false)}>使用组织术语表</button></div>}
    </>}
    {error && <div role="alert">{error}<button disabled={store.loading || store.busy} onClick={() => void store.refresh()}>刷新当前关联</button></div>}
  </div>;
}
