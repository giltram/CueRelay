import type { JsonRequest } from '../contracts/http';
import { useGlossary } from '../glossary-data/use-glossary';
import { ProjectGlossaryActions } from './ProjectGlossaryActions';
import { GlossaryBrowser } from './GlossaryBrowser';

export function GlossaryPanel({ request, organizationId, projectId, enabled, editable, canInsert, onInsert }: {
  request: JsonRequest; organizationId: number; projectId: number; enabled: boolean; editable: boolean;
  canInsert: boolean; onInsert: (translation: string) => void;
}) {
  const store = useGlossary(request, organizationId, projectId, enabled);
  return <aside className="glossary-panel" aria-label="术语表" data-glossary>
    <h2>术语表</h2>
    {editable && <ProjectGlossaryActions store={store} />}
    <GlossaryBrowser store={store} editable={enabled && editable && !store.data?.archived && store.data?.uses_organization_default === false}
      canInsert={canInsert && !store.data?.archived} onInsert={onInsert} />
  </aside>;
}
