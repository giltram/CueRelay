import type { AssDocument } from '../contracts/subtitles';

/** Adopt authoritative definitions without changing cue edits or their identity. */
export function withStyleSnapshot(document: AssDocument, snapshot: AssDocument): AssDocument {
  if (document.source === snapshot.source && document.styles === snapshot.styles && document.script === snapshot.script) return document;
  return { ...document, source: snapshot.source, styles: snapshot.styles, script: snapshot.script };
}
