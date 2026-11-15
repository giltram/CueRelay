import type { JsonRequest } from '../contracts/http';
import type { AssociationToken, EntryValues, GlossaryAssociation, GlossaryEntry, GlossaryPage } from '../contracts/glossary';

export function glossaryApi(request: JsonRequest, organizationId: number, projectId?: number) {
  const base = projectId === undefined ? `/organizations/${organizationId}/glossary` : `/organizations/${organizationId}/projects/${projectId}/glossary`;
  const query = (search: string, page: number) => new URLSearchParams({ search, page: String(page) });
  return {
    read: (search: string, page: number) => request<GlossaryPage>(`${base}?${query(search, page)}`),
    entry: async (tableId: string, entryId: string) => (await request<{ entry: GlossaryEntry }>(`${base}/${tableId}/entries/${entryId}`)).entry,
    save: (token: AssociationToken, values: EntryValues, entry?: GlossaryEntry) => request<GlossaryAssociation & { entry: GlossaryEntry }>(
      entry ? `${base}/${token.glossary_id}/entries/${entry.id}` : base, entry ? 'PUT' : 'POST',
      { ...token, original: values.original, translation: values.translation, note: values.note, ...(entry ? { revision: entry.revision } : {}) }),
    associate: (token: AssociationToken, choice: { fork: true } | { use_organization_default: true }) => request<GlossaryAssociation>(base, 'PUT', { ...token, ...choice }),
  };
}
