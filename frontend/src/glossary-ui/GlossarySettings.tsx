import type { JsonRequest } from '../contracts/http';
import { useGlossary } from '../glossary-data/use-glossary';
import { GlossaryBrowser } from './GlossaryBrowser';
import { ProjectGlossaryActions } from './ProjectGlossaryActions';

export function GlossarySettings({ request, organizationId, projectId, enabled, archived, canManage }: {
  request: JsonRequest; organizationId: number; projectId: number; enabled: boolean; archived: boolean; canManage: boolean;
}) {
  const store = useGlossary(request, organizationId, projectId, enabled);
  const active = enabled && !archived && !store.data?.archived;
  return <section className="account-form" aria-label="项目术语表" data-glossary>
    <h2>术语表</h2>
    {!archived && <ProjectGlossaryActions store={store} canManage={canManage} />}
    <GlossaryBrowser store={store} editable={active && store.data?.uses_organization_default === false} table />
  </section>;
}
