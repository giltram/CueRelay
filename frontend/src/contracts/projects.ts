import type { AssDocument } from './subtitles';

export interface MediaManifest { sha256: string; size: number; duration_ms: number }
export interface ProjectSummary {
  id: number; organization_id: number; name: string; description: string;
  status: 'active' | 'archived'; revision: number; created_at: string; updated_at: string;
  updated_by: { username: string };
  archived_at: string | null; archived_by: { username: string } | null;
}
export interface ProjectDetail extends ProjectSummary { media: MediaManifest; document: AssDocument }
export interface ProjectPage { projects: ProjectSummary[]; total: number; page: number; has_more: boolean }
