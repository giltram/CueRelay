import type { ProjectStyle, ScriptSettings, StyleUsage } from './styles';

/** Milliseconds on a 10ms grid. Raw ASS text uses \N, not HTML. */
export interface Cue {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  style_id: string;
  /** Original ASS metadata anchor retained when splitting or duplicating a source row. */
  source_id?: string;
  /** Clipboard-only preservation of hidden ASS fields; no editable UI for these. */
  ass_fields?: { Layer: string; Name: string; MarginL: string; MarginR: string; MarginV: string };
}

/** source is a validated raw template, owned by the backend codec. */
export interface AssDocument {
  schema_version: 2;
  source: string;
  script: ScriptSettings;
  styles: ProjectStyle[];
  cues: Cue[];
}

export interface SplitRequest {
  document: AssDocument;
  cue_id: string;
  mode: 'playhead' | 'text';
  /** 10ms-grid milliseconds for playhead, UTF-16 textarea offset for text. */
  position: number;
}
export interface SplitResult {
  document: AssDocument;
  first_id: string;
  second_id: string;
}
export interface StyleResult { document: AssDocument; usage: StyleUsage }
