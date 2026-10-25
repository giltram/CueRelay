import type { AssDocument } from '../contracts/subtitles';

export const DEFAULT_CUE_DURATION_MS = 2000;

/** Bootstrap an empty editor without changing an imported document's existing rows. */
export function initializeDocument(document: AssDocument, createId: () => string): AssDocument {
  if (document.cues.length) return document;
  return { ...document, cues: [{
    id: createId(), start_ms: 0, end_ms: DEFAULT_CUE_DURATION_MS, text: '', style_id: document.styles[0].id,
  }] };
}
