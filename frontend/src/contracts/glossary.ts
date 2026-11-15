export interface GlossaryTable { id: string; name: string; created_at: string; project_count: number; is_organization_default: boolean }
export interface GlossaryEntry {
  id: string; original: string; translation: string; note: string; revision: number;
  updated_by: { username: string }; updated_at: string;
}
export interface GlossaryAssociation { uses_organization_default: boolean; association_version: number; table: GlossaryTable | null; archived: boolean }
export interface GlossaryPage extends GlossaryAssociation {
  entries: GlossaryEntry[]; total: number; page: number; has_more: boolean; empty: boolean;
}
export interface EntryValues { original: string; translation: string; note: string }
export interface AssociationToken { association_version: number; glossary_id: string | null }
export const associationToken = (value: GlossaryAssociation): AssociationToken => ({ association_version: value.association_version, glossary_id: value.table?.id ?? null });
