import type { JsonRequest } from '../contracts/http';
import { useGlossary } from '../glossary-data/use-glossary';
import { GlossaryBrowser } from './GlossaryBrowser';

/** One organization default, using the same entry forms and concurrency boundary. */
export function OrganizationGlossary({ request, organizationId, enabled }: {
  request: JsonRequest; organizationId: number; enabled: boolean;
}) {
  const store = useGlossary(request, organizationId, undefined, enabled);
  return <section className="account-form organization-glossary" aria-label="组织术语表" data-glossary>
    <h2>组织术语表</h2>
    <p className="hint">项目默认使用这份术语表。使用独立术语表的项目不会自动回写或合并词条。</p>
    <GlossaryBrowser store={store} editable={enabled} table />
  </section>;
}
