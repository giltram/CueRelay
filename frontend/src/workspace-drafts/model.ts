import type { AssDocument } from '../contracts/subtitles';

export interface TimingDraft {
  cueId: string | null;
  startText: string;
  endText: string;
}

export interface DraftContent {
  document: AssDocument;
  timing: TimingDraft | null;
  baseRevision: number | null;
}

export interface WorkspaceDraft extends DraftContent {
  id: string;
  scope: string;
  tabId: string;
  version: string;
  updatedAt: number;
  schemaVersion: 1;
}

export function draftScope(userId: number, organizationId?: number, projectId?: number): string {
  return JSON.stringify([userId, organizationId ?? null, projectId ?? null]);
}

export function sameDraftContent(a: DraftContent | null, b: DraftContent | null): boolean {
  return a === b || Boolean(a && b && a.document === b.document && a.baseRevision === b.baseRevision
    && a.timing?.cueId === b.timing?.cueId && a.timing?.startText === b.timing?.startText
    && a.timing?.endText === b.timing?.endText);
}
